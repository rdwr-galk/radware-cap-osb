/**
 * IBM Cloudant database store for service instances, bindings and operations
 * Production-ready persistent storage implementation for OSB state
 */

const { CloudantV1 } = require('@ibm-cloud/cloudant');
const { IamAuthenticator } = require('ibm-cloud-sdk-core');
const logger = require('../utils/logger');

class CloudantStore {
  constructor() {
    this.client = null;
    this.dbName = process.env.CLOUDANT_DB || 'radware-osb';
    this.initialized = false;
  }

  async _initClient(retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 2000 * (retryCount + 1); // 2s, 4s, 6s delays
    
    try {
      const cloudantUrl = process.env.CLOUDANT_URL;
      const cloudantApiKey = process.env.CLOUDANT_APIKEY;

      if (!cloudantUrl || !cloudantApiKey) {
        logger.warn('CLOUDANT_URL and CLOUDANT_APIKEY not provided - Cloudant features disabled');
        return false;
      }

      // Extract host from URL (remove iamBearer query param for service URL)
      const url = new URL(cloudantUrl);
      const serviceUrl = `${url.protocol}//${url.host}`;
      
      logger.info({ 
        serviceUrl, 
        dbName: this.dbName,
        hasIamBearer: cloudantUrl.includes('iamBearer='),
        retryAttempt: retryCount + 1
      }, 'Initializing Cloudant client with IAM authentication');

      // Use IAM authenticator - this is the only supported method for IBM Cloudant
      const authenticator = new IamAuthenticator({ 
        apikey: cloudantApiKey,
        // Allow disabling SSL in development for corporate firewalls
        disableSslVerification: process.env.NODE_ENV !== 'production' && process.env.DISABLE_SSL_VERIFY === 'true'
      });

      this.client = CloudantV1.newInstance({ 
        authenticator,
        serviceUrl: serviceUrl
      });

      // Test the connection immediately with a simple operation
      await this.client.getAllDbs();
      
      logger.info({ dbName: this.dbName, serviceUrl }, '✅ Cloudant client initialized and tested successfully');
      return true;
    } catch (error) {
      // Enhanced error categorization for better troubleshooting
      let errorCategory = 'unknown';
      let troubleshootingTip = '';

      if (error.code === 'ENOTFOUND') {
        errorCategory = 'dns';
        troubleshootingTip = 'Check DNS resolution and network connectivity';
      } else if (error.code === 'ECONNREFUSED') {
        errorCategory = 'network';
        troubleshootingTip = 'Check firewall rules and network access';
      } else if (error.code === 'ETIMEDOUT') {
        errorCategory = 'timeout';
        troubleshootingTip = 'Check network latency and firewall timeouts';
      } else if (error.message && error.message.includes('Client network socket disconnected')) {
        errorCategory = 'ssl_handshake';
        troubleshootingTip = 'SSL/TLS handshake failed - check corporate firewall or proxy settings';
      } else if (error.status === 401) {
        errorCategory = 'authentication';
        troubleshootingTip = 'Check CLOUDANT_APIKEY validity';
      } else if (error.status === 403) {
        errorCategory = 'authorization';
        troubleshootingTip = 'Check API key permissions for Cloudant service';
      } else if (error.status >= 500) {
        errorCategory = 'server';
        troubleshootingTip = 'Cloudant service may be experiencing issues';
      }

      const isRetryable = retryCount < maxRetries && (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.message?.includes('Client network socket disconnected') ||
        (error.status >= 500 && error.status < 600)
      );

      if (isRetryable) {
        logger.warn({ 
          error: error.message, 
          errorCategory,
          retryAttempt: retryCount + 1, 
          maxRetries,
          nextRetryIn: retryDelay,
          troubleshootingTip
        }, '🔄 Cloudant initialization failed, retrying...');
        
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this._initClient(retryCount + 1);
      }

      logger.error({ 
        error: error.message, 
        errorCategory,
        retryAttempt: retryCount + 1,
        code: error.code,
        status: error.status,
        troubleshootingTip
      }, '❌ Failed to initialize Cloudant client after all retries');
      
      throw error;
    }
  }


  async _ensureInitialized() {
    if (this.client && this.initialized) return;
    
    const clientReady = await this._initClient();
    if (!clientReady) {
      throw new Error('Cloudant client initialization failed - missing credentials');
    }
  }

  async _ensureDatabase() {
    await this._ensureInitialized();
    if (this.initialized) return;

    try {
      // Try to create database (ignore if it already exists)
      try {
        await this.client.putDatabase({ db: this.dbName });
        logger.info({ dbName: this.dbName }, 'Created Cloudant database');
      } catch (error) {
        if (error.status === 412) {
          logger.debug({ dbName: this.dbName }, 'ℹ Database already exists');
        } else {
          throw error;
        }
      }

      this.initialized = true;
    } catch (error) {
      logger.error({ error: error.message }, 'Database initialization failed');
      throw error;
    }
  }

  async ping() {
    try {
      await this._ensureInitialized();
      if (!this.client) {
        logger.warn('Cloudant ping failed - client not initialized');
        return false;
      }
      
      const startTime = Date.now();
      const response = await this.client.getAllDbs();
      const latency = Date.now() - startTime;
      
      const isHealthy = Array.isArray(response.result);
      logger.debug({ 
        latency, 
        dbCount: response.result?.length || 0,
        healthy: isHealthy 
      }, 'Cloudant ping completed');
      
      return isHealthy;
    } catch (error) {
      logger.error({ 
        error: error.message, 
        code: error.code,
        status: error.status 
      }, 'Cloudant ping failed');
      return false;
    }
  }



  // ---------- Instances ----------

  async createInstance(instanceId, instanceData) {
    await this._ensureDatabase();
    
    const docId = `instance_${instanceId}`;
    const now = new Date().toISOString();
    
    const doc = {
      _id: docId,
      type: 'instance',
      instanceId,
      ...instanceData,
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.client.putDocument({
        db: this.dbName,
        docId,
        document: doc
      });
      
      logger.info({ instanceId, serviceId: instanceData.serviceId }, 'Instance created in Cloudant');
      return doc;
    } catch (error) {
      if (error.status === 409) {
        throw new Error(`Instance ${instanceId} already exists`);
      }
      logger.error({ error: error.message, instanceId }, 'Failed to create instance');
      throw error;
    }
  }

  async getInstance(instanceId) {
    await this._ensureDatabase();
    
    const docId = `instance_${instanceId}`;
    try {
      const response = await this.client.getDocument({
        db: this.dbName,
        docId
      });
      return response.result;
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      logger.error({ error: error.message, instanceId }, 'Failed to get instance');
      throw error;
    }
  }

  async listInstances() {
    await this._ensureDatabase();
    
    try {
      const response = await this.client.postFind({
        db: this.dbName,
        selector: { type: 'instance' },
        limit: 1000
      });
      return response.result.docs || [];
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to list instances');
      throw error;
    }
  }

  async updateInstance(instanceId, updates) {
    await this._ensureDatabase();
    
    const current = await this.getInstance(instanceId);
    if (!current) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const updated = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    try {
      await this.client.putDocument({
        db: this.dbName,
        docId: current._id,
        document: updated
      });
      
      logger.info({ instanceId }, 'Instance updated in Cloudant');
      return updated;
    } catch (error) {
      logger.error({ error: error.message, instanceId }, 'Failed to update instance');
      throw error;
    }
  }

  async deleteInstance(instanceId) {
    await this._ensureDatabase();
    
    try {
      const instance = await this.getInstance(instanceId);
      if (!instance) {
        return false;
      }

      // Delete the instance
      await this.client.deleteDocument({
        db: this.dbName,
        docId: instance._id,
        rev: instance._rev
      });

      // Cascade: delete all bindings for this instance
      const bindings = await this.getBindingsByInstance(instanceId);
      for (const binding of bindings) {
        await this.client.deleteDocument({
          db: this.dbName,
          docId: binding._id,
          rev: binding._rev
        });
      }

      // Clear completed operations for this instance
      const operations = await this.listOperationsByInstance(instanceId);
      for (const op of operations) {
        if (op.state === 'succeeded' || op.state === 'failed') {
          await this.client.deleteDocument({
            db: this.dbName,
            docId: op._id,
            rev: op._rev
          });
        }
      }

      logger.info({ instanceId }, 'Instance deleted from Cloudant');
      return true;
    } catch (error) {
      logger.error({ error: error.message, instanceId }, 'Failed to delete instance');
      throw error;
    }
  }

  // ---------- Bindings ----------

  async createBinding(instanceId, bindingId, bindingData) {
    await this._ensureDatabase();
    
    // Check if instance exists
    const instance = await this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found for binding ${bindingId}`);
    }

    const docId = `binding_${bindingId}`;
    const doc = {
      _id: docId,
      type: 'binding',
      instanceId,
      bindingId,
      ...bindingData,
      createdAt: new Date().toISOString()
    };

    try {
      await this.client.putDocument({
        db: this.dbName,
        docId,
        document: doc
      });
      
      logger.info({ instanceId, bindingId }, 'Binding created in Cloudant');
      return doc;
    } catch (error) {
      if (error.status === 409) {
        throw new Error(`Binding ${bindingId} already exists`);
      }
      logger.error({ error: error.message, bindingId }, 'Failed to create binding');
      throw error;
    }
  }

  async getBinding(bindingId) {
    await this._ensureDatabase();
    
    const docId = `binding_${bindingId}`;
    try {
      const response = await this.client.getDocument({
        db: this.dbName,
        docId
      });
      return response.result;
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      logger.error({ error: error.message, bindingId }, 'Failed to get binding');
      throw error;
    }
  }

  async listBindings() {
    await this._ensureDatabase();
    
    try {
      const response = await this.client.postFind({
        db: this.dbName,
        selector: { type: 'binding' },
        limit: 1000
      });
      return response.result.docs || [];
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to list bindings');
      throw error;
    }
  }

  async getBindingsByInstance(instanceId) {
    await this._ensureDatabase();
    
    try {
      const response = await this.client.postFind({
        db: this.dbName,
        selector: { 
          type: 'binding',
          instanceId: instanceId
        },
        limit: 1000
      });
      return response.result.docs || [];
    } catch (error) {
      logger.error({ error: error.message, instanceId }, 'Failed to get bindings by instance');
      throw error;
    }
  }

  async updateBinding(bindingId, updates) {
    await this._ensureDatabase();
    
    const current = await this.getBinding(bindingId);
    if (!current) {
      throw new Error(`Binding ${bindingId} not found`);
    }

    const updated = { ...current, ...updates };
    
    try {
      await this.client.putDocument({
        db: this.dbName,
        docId: current._id,
        document: updated
      });
      
      logger.info({ bindingId }, 'Binding updated in Cloudant');
      return updated;
    } catch (error) {
      logger.error({ error: error.message, bindingId }, 'Failed to update binding');
      throw error;
    }
  }

  async deleteBinding(bindingId) {
    await this._ensureDatabase();
    
    try {
      const binding = await this.getBinding(bindingId);
      if (!binding) {
        return false;
      }

      await this.client.deleteDocument({
        db: this.dbName,
        docId: binding._id,
        rev: binding._rev
      });
      
      logger.info({ bindingId }, 'Binding deleted from Cloudant');
      return true;
    } catch (error) {
      logger.error({ error: error.message, bindingId }, 'Failed to delete binding');
      throw error;
    }
  }

  // ---------- Operations ----------

  async setOperation(instanceId, operationId, operationData) {
    await this._ensureDatabase();
    
    const docId = `operation_${operationId}`;
    const now = new Date().toISOString();

    const doc = {
      _id: docId,
      type: 'operation',
      instanceId,
      operationId,
      ...operationData,
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.client.putDocument({
        db: this.dbName,
        docId,
        document: doc
      });
      
      logger.info({ instanceId, operationId, state: doc.state }, 'Operation tracked in Cloudant');
      return doc;
    } catch (error) {
      logger.error({ error: error.message, operationId }, 'Failed to set operation');
      throw error;
    }
  }

  async getOperation(operationId) {
    await this._ensureDatabase();
    
    const docId = `operation_${operationId}`;
    try {
      const response = await this.client.getDocument({
        db: this.dbName,
        docId
      });
      return response.result;
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      logger.error({ error: error.message, operationId }, 'Failed to get operation');
      throw error;
    }
  }

  async listOperationsByInstance(instanceId) {
    await this._ensureDatabase();
    
    try {
      const response = await this.client.postFind({
        db: this.dbName,
        selector: { 
          type: 'operation',
          instanceId: instanceId
        },
        limit: 1000
      });
      return response.result.docs || [];
    } catch (error) {
      logger.error({ error: error.message, instanceId }, 'Failed to list operations by instance');
      throw error;
    }
  }

  async updateOperation(operationId, state, description = null) {
    await this._ensureDatabase();
    
    const operation = await this.getOperation(operationId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found`);
    }

    operation.state = state;
    operation.updatedAt = new Date().toISOString();
    if (description !== null && description !== undefined) {
      operation.description = description;
    }

    try {
      await this.client.putDocument({
        db: this.dbName,
        docId: operation._id,
        document: operation
      });
      
      logger.info({ operationId, state }, 'Operation updated in Cloudant');
      return operation;
    } catch (error) {
      logger.error({ error: error.message, operationId }, 'Failed to update operation');
      throw error;
    }
  }

  async deleteOperation(operationId) {
    await this._ensureDatabase();
    
    try {
      const operation = await this.getOperation(operationId);
      if (!operation) {
        return false;
      }

      await this.client.deleteDocument({
        db: this.dbName,
        docId: operation._id,
        rev: operation._rev
      });
      
      logger.info({ operationId, instanceId: operation.instanceId }, 'Operation deleted from Cloudant');
      return true;
    } catch (error) {
      logger.error({ error: error.message, operationId }, 'Failed to delete operation');
      throw error;
    }
  }

  async clearOperationsForInstance(instanceId) {
    await this._ensureDatabase();
    
    try {
      const operations = await this.listOperationsByInstance(instanceId);
      
      for (const op of operations) {
        await this.client.deleteDocument({
          db: this.dbName,
          docId: op._id,
          rev: op._rev
        });
      }
      
      logger.info({ instanceId }, 'Operations cleared for instance in Cloudant');
    } catch (error) {
      logger.error({ error: error.message, instanceId }, 'Failed to clear operations');
      throw error;
    }
  }

  async hasPendingOperation(instanceId) {
    await this._ensureDatabase();
    
    try {
      const response = await this.client.postFind({
        db: this.dbName,
        selector: { 
          type: 'operation',
          instanceId: instanceId,
          state: 'in progress'
        },
        limit: 1
      });
      
      return (response.result.docs || []).length > 0;
    } catch (error) {
      logger.error({ error: error.message, instanceId }, 'Failed to check pending operations');
      return false;
    }
  }

  /**
   * Alternative ping method for health checks using database info
   */
  async healthCheck() {
    try {
      await this._ensureInitialized();
      if (!this.client) return false;
      
      // Simple database info call to test connectivity
      await this.client.getDatabaseInformation({ db: this.dbName });
      return true;
    } catch (error) {
      logger.warn({ error: error.message, dbName: this.dbName }, 'Cloudant health check failed');
      return false;
    }
  }
}

module.exports = new CloudantStore();