/**
 * Radware backend client for CAP (CWAF) service integration
 * Handles all communication with Radware APIs
 */

const loadConfig = require('../config');
const axios = require('axios');
const logger = require('../utils/logger');

class RadwareApi {
  constructor(config) {
    this.apiBase = config.radware.apiBase;
    this.apiToken = config.radware.apiToken;
    this.timeout = config.radware.timeout || 10000;
    this.retries = config.radware.retries || 3;

    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiToken}`
    };

    if (config.radware.gatewaySystemRoleId) {
      defaultHeaders['x-role-ids'] = config.radware.gatewaySystemRoleId;
    }

    this.client = axios.create({
      baseURL: this.apiBase,
      timeout: this.timeout,
      headers: defaultHeaders
    });

    logger.info({ apiBase: this.apiBase, timeout: this.timeout }, 'RadwareApi initialized');
  }

  // === Factory ===
  static async newInstance() {
    const config = await loadConfig();
    return new RadwareApi(config);
  }

  // === Basic connectivity check ===
  async ping() {
    try {
      await this.makeRequest({
        method: 'POST',
        url: '/api/sdcc/system/entity/accounts?databaseType=ORIGIN',
        data: { criteria: [], projection: ['id'], page: 0, size: 1 }
      });
      return true;
    } catch (error) {
      logger.warn({ error: error.message }, 'Radware API ping failed');
      return false;
    }
  }

  // === Core request handler ===
  async makeRequest(requestConfig, retryCount = 0) {
    try {
      const response = await this.client(requestConfig);
      logger.debug(
        {
          method: requestConfig.method,
          url: requestConfig.url,
          status: response.status
        },
        'Radware API request successful'
      );
      return response.data;
    } catch (error) {
      const isRetryable = this.isRetryableError(error);
      const shouldRetry = retryCount < this.retries && isRetryable;

      if (shouldRetry) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await this.sleep(delay);
        return this.makeRequest(requestConfig, retryCount + 1);
      }

      throw this.mapError(error);
    }
  }

  isRetryableError(error) {
    if (!error.response) return true;
    const status = error.response.status;
    return status >= 500 || status === 408 || status === 429;
  }

  mapError(error) {
    const mapped = new Error();
    if (!error.response) {
      mapped.status = 502;
      mapped.description = 'Unable to connect to Radware backend service';
      return mapped;
    }

    const status = error.response.status;
    const data = error.response.data;

    switch (status) {
      case 400:
        mapped.status = 400;
        mapped.description = data?.message || 'Invalid request to Radware backend';
        break;
      case 401:
        mapped.status = 502;
        mapped.description = 'Authentication failed with Radware backend';
        break;
      case 403:
        mapped.status = 502;
        mapped.description = 'Access denied by Radware backend';
        break;
      case 404:
        mapped.status = 410;
        mapped.description = 'Resource not found in Radware backend';
        break;
      case 409:
        mapped.status = 409;
        mapped.description = data?.message || 'Conflict in Radware backend';
        break;
      case 422:
        mapped.status = 422;
        mapped.description = data?.message || 'Invalid parameters for Radware backend';
        break;
      default:
        mapped.status = 502;
        mapped.description = 'Radware backend service error';
    }

    return mapped;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // === All your business logic methods ===
  async createAccountOrServiceForInstance({ instanceId, planId, parameters = {} }) {
    logger.info({ instanceId, planId }, 'Creating account and CWAF service (CAP)');

    try {
      const accountPayload = {
        name: parameters.customerName || `OSB-Instance-${instanceId}`,
        type: parameters.accountType || 'STANDARD',
        description: parameters.accountDescription || `Created via OSB for instance ${instanceId}`
      };

      const accountData = await this.createAccount({ payload: accountPayload });

      const cwafPayload = {
        accountId: accountData.id,
        type: 'CWAF',
        planType: parameters.planType || 'STANDARD',
        applicationLimit: parameters.applicationLimit ?? 1,
        bandwidthLimit: parameters.bandwidthLimit ?? 10,
        dataResidency: parameters.dataResidency || 'US_REGION',
        popRegions: parameters.popRegions || ['North America (Ashburn)'],
        startTimestamp: parameters.startTimestamp || new Date().toISOString(),
        endTimestamp: parameters.endTimestamp || '2066-12-30T22:06:57',
        addons: parameters.addons || {
          cdn: { enabled: false },
          unlimitedDdosProtection: { enabled: false },
          webDDOS: { enabled: false },
          cbot: { enabled: false },
          premiumSupport: { enabled: false },
          eaaf: { enabled: false }
        }
      };

      const serviceData = await this.createService({ payload: cwafPayload });

      logger.info(
        { instanceId, accountId: accountData.id, serviceId: serviceData.id },
        'Account and CWAF service created successfully'
      );

      return {
        accountId: accountData.id,
        serviceId: serviceData.id,
        accountData,
        serviceData
      };
    } catch (error) {
      logger.error({ instanceId, error: error.message }, 'Failed to create account/service');
      throw error;
    }
  }

  async deleteAccountOrService({ accountId, serviceId }) {
    logger.info({ accountId, serviceId }, 'Deleting Radware account/service');

    try {
      if (serviceId) {
        await this.makeRequest({
          method: 'DELETE',
          url: `/api/sdcc/system/entity/services/${serviceId}?databaseType=ORIGIN`,
          data: {} // backend may require a body with type; adjust if needed
        });
      }

      await this.makeRequest({
        method: 'DELETE',
        url: `/api/sdcc/system/entity/accounts/${accountId}?databaseType=ORIGIN`
      });

      logger.info({ accountId }, 'Radware account/service deleted');
    } catch (error) {
      logger.error({ accountId, error: error.message }, 'Failed to delete Radware account/service');
      throw error;
    }
  }

  async createContactUser({ accountId, email, additionalData = {} }) {
    logger.info({ accountId, email }, 'Creating Radware contact user');

    try {
      const userData = await this.makeRequest({
        method: 'PUT',
        url: '/api/sdcc/system/entity/users?databaseType=ORIGIN',
        data: {
          accountId,
          userType: 'CONTACT',
          email,
          firstName: additionalData.firstName || 'OSB',
          lastName: additionalData.lastName || 'User',
          responsibilities: additionalData.responsibilities,
          escalationTypes: additionalData.escalationTypes,
          jobTitle: additionalData.jobTitle,
          phone: additionalData.phone,
          description: additionalData.description,
          timezone: additionalData.timezone,
          fullName: additionalData.fullName
        }
      });

      logger.info({ userId: userData.id, email, accountId }, 'Radware contact user created');

      return {
        id: userData.id,
        email: userData.email,
        accountId
      };
    } catch (error) {
      logger.error({ accountId, email, error: error.message }, 'Failed to create Radware contact user');
      throw error;
    }
  }

  async deleteContactUser({ id }) {
    logger.info({ userId: id }, 'Deleting Radware contact user');

    try {
      await this.makeRequest({
        method: 'DELETE',
        url: `/api/sdcc/system/entity/users/${id}?databaseType=ORIGIN`
      });

      logger.info({ userId: id }, 'Radware contact user deleted');
    } catch (error) {
      logger.error({ userId: id, error: error.message }, 'Failed to delete Radware contact user');
      throw error;
    }
  }

  /**
   * Accounts
   */
  async queryAccounts({ criteria = [], projection = [], page = 0, size = 100 } = {}) {
    const body = {};
    if (criteria && criteria.length) body.criteria = criteria;
    if (projection && projection.length) body.projection = projection;

    return this.makeRequest({
      method: 'POST',
      url: '/api/sdcc/system/entity/accounts?databaseType=ORIGIN',
      data: body
    });
  }

  async getAccountById({ accountId }) {
    return this.makeRequest({
      method: 'GET',
      url: `/api/sdcc/system/entity/accounts/${accountId}?databaseType=ORIGIN`
    });
  }

  async createAccount({ payload }) {
    return this.makeRequest({
      method: 'PUT',
      url: '/api/sdcc/system/entity/accounts?databaseType=ORIGIN',
      data: payload
    });
  }

  async updateAccount({ accountId, payload }) {
    return this.makeRequest({
      method: 'POST',
      url: `/api/sdcc/system/entity/accounts/${accountId}?databaseType=ORIGIN`,
      data: payload
    });
  }

  async deleteAccount({ accountId }) {
    return this.makeRequest({
      method: 'DELETE',
      url: `/api/sdcc/system/entity/accounts/${accountId}?databaseType=ORIGIN`
    });
  }

  /**
   * Users (CONTACT)
   */
  async queryUsers({ criteria = [], projection = [] } = {}) {
    return this.makeRequest({
      method: 'POST',
      url: '/api/sdcc/system/entity/users?databaseType=ORIGIN', // no trailing slash before ?
      data: { criteria, projection }
    });
  }

  async getUserById({ userId }) {
    return this.makeRequest({
      method: 'GET',
      url: `/api/sdcc/system/entity/users/${userId}?databaseType=ORIGIN`
    });
  }

  async createUser({ payload }) {
    return this.makeRequest({
      method: 'PUT',
      url: '/api/sdcc/system/entity/users?databaseType=ORIGIN',
      data: payload
    });
  }

  async updateUser({ userId, payload }) {
    return this.makeRequest({
      method: 'POST',
      url: `/api/sdcc/system/entity/users/${userId}?databaseType=ORIGIN`,
      data: payload
    });
  }

  async deleteUser({ userId }) {
    return this.makeRequest({
      method: 'DELETE',
      url: `/api/sdcc/system/entity/users/${userId}?databaseType=ORIGIN`
    });
  }

  /**
   * Services (CWAF / CDDOS / CTRC)
   */
  async createService({ payload }) {
    return this.makeRequest({
      method: 'PUT',
      url: '/api/sdcc/system/entity/services?databaseType=ORIGIN',
      data: payload
    });
  }

  async updateService({ serviceId, payload }) {
    return this.makeRequest({
      method: 'POST',
      url: `/api/sdcc/system/entity/services/${serviceId}?databaseType=ORIGIN`,
      data: payload
    });
  }

  async getService({ serviceId }) {
    return this.makeRequest({
      method: 'GET',
      url: `/api/sdcc/system/entity/services/${serviceId}?databaseType=ORIGIN`
    });
  }

  async deleteService({ serviceId, payload = {} }) {
    // Some backends expect a body with the service type on delete (e.g., { type: "CWAF" }).
    return this.makeRequest({
      method: 'DELETE',
      url: `/api/sdcc/system/entity/services/${serviceId}?databaseType=ORIGIN`,
      data: payload
    });
  }

  /**
   * Dedicated helper for OSB PATCH plan updates (map OSB plan to backend fields if needed)
   */
  async updateServicePlan({ serviceId, newPlanId, params = {} }) {
    logger.info({ serviceId, newPlanId }, 'Updating Radware service plan');

    try {
      // If your backend expects planType vs planId or additional fields, map here.
      const payload = {
        // Example: if your backend uses "planType" instead of planId:
        // planType: newPlanId,
        planId: newPlanId,
        ...params
      };

      const resp = await this.updateService({ serviceId, payload });
      logger.info({ serviceId, newPlanId }, 'Radware service plan updated');
      return resp;
    } catch (error) {
      logger.error({ serviceId, error: error.message }, 'Failed to update Radware service plan');
      throw error;
    }
  }

  /**
   * Sites / Assets / Attacks
   */
  async getSitesByAccount({ cddosAccountId }) {
    return this.makeRequest({
      method: 'GET',
      url: `/api/site/${cddosAccountId}?type=account&id=${cddosAccountId}`
    });
  }

  async getAssetsByAccount({ cddosAccountId }) {
    return this.makeRequest({
      method: 'GET',
      url: `/api/assets?type=account&id=${cddosAccountId}`
    });
  }

  async querySecurityEvents({ criteria = {} } = {}) {
    return this.makeRequest({
      method: 'POST',
      url: '/api/sdcc/attack/core/analytics/object/vision/securityevents',
      data: criteria
    });
  }

  /**
   * Auth0 users aggregated per account
   */
  async getAuth0UsersForAccount({ accountId }) {
    return this.makeRequest({
      method: 'GET',
      url: `/sdcc/system/core/user/_getUsers?accountId=${accountId}`
    });
  }
}

// Export the class, not an instance
module.exports = RadwareApi;
