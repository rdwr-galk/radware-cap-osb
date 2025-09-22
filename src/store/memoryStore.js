/**
 * Simple in-memory state store for service instances, bindings and operations
 * NOTE: This is NOT persistent. Replace with a real database in production.
 */

const logger = require('../utils/logger');

class MemoryStore {
  constructor() {
    this.instances = new Map();        // instanceId -> instance
    this.bindings = new Map();         // bindingId  -> binding
    this.operations = new Map();       // operationId -> operation
    this.instanceOps = new Map();      // instanceId -> Set(operationId)
    this.pendingOperations = new Set();// instanceIds with at least one in-progress op

    logger.info('MemoryStore initialized (in-memory)');
  }

  // ---------- Instances ----------

  createInstance(instanceId, instanceData) {
    if (this.instances.has(instanceId)) {
      throw new Error(`Instance ${instanceId} already exists`);
    }

    const now = new Date().toISOString();
    const instance = {
      ...instanceData,
      instanceId,
      createdAt: now,
      updatedAt: now
    };

    this.instances.set(instanceId, instance);
    logger.info({ instanceId, serviceId: instanceData.serviceId }, 'Instance created');
    return instance;
  }

  getInstance(instanceId) {
    return this.instances.get(instanceId) || null;
  }

  listInstances() {
    return Array.from(this.instances.values());
  }

  updateInstance(instanceId, updates) {
    const current = this.instances.get(instanceId);
    if (!current) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const updated = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    this.instances.set(instanceId, updated);
    logger.info({ instanceId }, 'Instance updated');
    return updated;
  }

  deleteInstance(instanceId) {
    const existed = this.instances.delete(instanceId);

    if (existed) {
      // Cascade: delete all bindings attached to this instance
      for (const [bindingId, binding] of this.bindings.entries()) {
        if (binding.instanceId === instanceId) {
          this.bindings.delete(bindingId);
        }
      }

      // Clear operations for this instance ONLY if they are in terminal state
      // Keep in-progress operations so they can complete properly
      const operationIds = this.instanceOps.get(instanceId);
      if (operationIds) {
        const toDelete = [];
        for (const opId of operationIds) {
          const op = this.operations.get(opId);
          if (op && (op.state === 'succeeded' || op.state === 'failed')) {
            toDelete.push(opId);
          }
        }
        
        // Remove completed operations
        for (const opId of toDelete) {
          this.operations.delete(opId);
          operationIds.delete(opId);
        }
        
        // Only delete the instance operations set if all operations are gone
        if (operationIds.size === 0) {
          this.instanceOps.delete(instanceId);
        }
      }

      // Keep pending flag if there are still in-progress operations
      const remainingOps = this.listOperationsByInstance(instanceId);
      const hasInProgress = remainingOps.some(
        (o) => o.state && o.state.toLowerCase() === 'in progress'
      );
      if (!hasInProgress) {
        this.pendingOperations.delete(instanceId);
      }

      logger.info({ instanceId }, 'Instance deleted');
    }

    return existed;
  }

  // ---------- Bindings ----------

  createBinding(instanceId, bindingId, bindingData) {
    if (this.bindings.has(bindingId)) {
      throw new Error(`Binding ${bindingId} already exists`);
    }
    if (!this.instances.has(instanceId)) {
      throw new Error(`Instance ${instanceId} not found for binding ${bindingId}`);
    }

    const binding = {
      ...bindingData,
      instanceId,
      bindingId,
      createdAt: new Date().toISOString()
    };

    this.bindings.set(bindingId, binding);
    logger.info({ instanceId, bindingId }, 'Binding created');
    return binding;
  }

  getBinding(bindingId) {
    return this.bindings.get(bindingId) || null;
  }

  listBindings() {
    return Array.from(this.bindings.values());
  }

  getBindingsByInstance(instanceId) {
    const result = [];
    for (const b of this.bindings.values()) {
      if (b.instanceId === instanceId) result.push(b);
    }
    return result;
  }

  updateBinding(bindingId, updates) {
    const current = this.bindings.get(bindingId);
    if (!current) {
      throw new Error(`Binding ${bindingId} not found`);
    }
    const updated = { ...current, ...updates };
    this.bindings.set(bindingId, updated);
    logger.info({ bindingId }, 'Binding updated');
    return updated;
  }

  deleteBinding(bindingId) {
    const deleted = this.bindings.delete(bindingId);
    if (deleted) {
      logger.info({ bindingId }, 'Binding deleted');
    }
    return deleted;
  }

  // ---------- Operations ----------

  setOperation(instanceId, operationId, operationData) {
    const now = new Date().toISOString();

    const op = {
      ...operationData,
      instanceId,
      operationId,
      createdAt: now,
      updatedAt: now
    };

    this.operations.set(operationId, op);

    // Track per-instance operations
    if (!this.instanceOps.has(instanceId)) {
      this.instanceOps.set(instanceId, new Set());
    }
    this.instanceOps.get(instanceId).add(operationId);

    // Mark instance as having a pending op if state is in-progress
    if (op.state && op.state.toLowerCase() === 'in progress') {
      this.pendingOperations.add(instanceId);
    }

    logger.info({ instanceId, operationId, state: op.state }, 'Operation tracked');
    return op;
  }

  getOperation(operationId) {
    return this.operations.get(operationId) || null;
  }

  listOperationsByInstance(instanceId) {
    const ids = this.instanceOps.get(instanceId);
    if (!ids) return [];
    const arr = [];
    for (const id of ids) {
      const op = this.operations.get(id);
      if (op) arr.push(op);
    }
    return arr;
  }

  updateOperation(operationId, state, description = null) {
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found`);
    }

    operation.state = state;
    operation.updatedAt = new Date().toISOString();
    if (description !== null && description !== undefined) {
      operation.description = description;
    }

    // If terminal state, clear pending flag for this instance (if no other in-progress ops remain)
    if (state === 'succeeded' || state === 'failed') {
      const instId = operation.instanceId;
      const ops = this.instanceOps.get(instId);
      if (ops) {
        // Check if any other op for this instance is still in progress
        let hasInProgress = false;
        for (const id of ops) {
          const o = this.operations.get(id);
          if (o && o.state && o.state.toLowerCase() === 'in progress') {
            hasInProgress = true;
            break;
          }
        }
        if (!hasInProgress) this.pendingOperations.delete(instId);
      } else {
        this.pendingOperations.delete(instId);
      }
    }

    logger.info({ operationId, state }, 'Operation updated');
    return operation;
  }

  deleteOperation(operationId) {
    const op = this.operations.get(operationId);
    if (!op) return false;

    // Remove from per-instance index
    const instId = op.instanceId;
    const set = this.instanceOps.get(instId);
    if (set) {
      set.delete(operationId);
      if (set.size === 0) this.instanceOps.delete(instId);
    }

    const ok = this.operations.delete(operationId);

    // Recompute pending flag for the instance
    if (ok) {
      const remaining = this.listOperationsByInstance(instId);
      const anyInProgress = remaining.some(
        (o) => o.state && o.state.toLowerCase() === 'in progress'
      );
      if (!anyInProgress) this.pendingOperations.delete(instId);
      logger.info({ operationId, instanceId: instId }, 'Operation deleted');
    }

    return ok;
  }

  clearOperationsForInstance(instanceId) {
    const ids = this.instanceOps.get(instanceId);
    if (ids) {
      for (const opId of ids) {
        this.operations.delete(opId);
      }
      this.instanceOps.delete(instanceId);
    }
    this.pendingOperations.delete(instanceId);
    logger.info({ instanceId }, 'Operations cleared for instance');
  }

  hasPendingOperation(instanceId) {
    return this.pendingOperations.has(instanceId);
  }
}

module.exports = new MemoryStore();
