/**
 * Open Service Broker API v2.12 Routes
 * Implements all required OSB endpoints for Radware CAP service (CWAF)
 */

const express = require('express');
const config = require('../config');
const logger = require('../utils/logger');
const memoryStore = require('../store/memoryStore');
const radwareApi = require('../services/radwareApi');

const router = express.Router();

/**
 * OSB header validation middleware
 */
function validateOSBHeaders(req, res, next) {
  const apiVersion = req.get('X-Broker-API-Version');

  if (!apiVersion) {
    return res.status(412).json({
      description: 'X-Broker-API-Version header is required'
    });
  }

  // Accept 2.12 or 2.13 (IBM platforms may send 2.13)
  if (!['2.12', '2.13'].includes(apiVersion)) {
    return res.status(412).json({
      description: 'Requires X-Broker-API-Version: 2.12 or 2.13'
    });
  }

  res.set({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });

  next();
}

// Apply OSB header validation to all routes
router.use(validateOSBHeaders);

/**
 * Service catalog definition
 */
const SERVICE_CATALOG = {
  services: [
    {
      id: 'cloud-application-protection-service',
      name: 'cloud-application-protection-service',
      description: 'Cloud Application Protection Service (CWAF)',
      bindable: true,
      plan_updateable: true,
      plans: [
        {
          id: 'standard',
          name: 'standard',
          description: 'Standard plan',
          free: false,
          bindable: true
        }
      ],
      metadata: {
        displayName: 'Cloud Application Protection Service',
        longDescription:
          'Radware Cloud Application Protection (CAP) provides comprehensive web application security',
        providerDisplayName: 'Radware',
        documentationUrl:
          'https://www.radware.com/products/cloud-application-protection/',
        supportUrl: 'https://support.radware.com/'
      }
    }
  ]
};

/**
 * GET /v2/catalog - Return service catalog
 */
router.get('/catalog', (req, res) => {
  logger.info({ correlationId: req.correlationId }, 'Catalog requested');
  res.status(200).json(SERVICE_CATALOG);
});

/**
 * PUT /v2/service_instances/:instance_id - Provision service instance
 */
router.put('/service_instances/:instance_id', async (req, res) => {
  const instanceId = req.params.instance_id;
  const { service_id, plan_id, context, parameters } = req.body;
  const acceptsIncomplete = req.query.accepts_incomplete === 'true';

  logger.info(
    {
      correlationId: req.correlationId,
      instanceId,
      serviceId: service_id,
      planId: plan_id,
      acceptsIncomplete
    },
    'Provision request received'
  );

  try {
    // Validate required fields
    if (!service_id || !plan_id) {
      return res.status(400).json({
        description: 'service_id and plan_id are required'
      });
    }

    // Idempotency: instance already exists
    const existingInstance = memoryStore.getInstance(instanceId);
    if (existingInstance) {
      if (
        existingInstance.serviceId === service_id &&
        existingInstance.planId === plan_id
      ) {
        return res.status(200).json({
          dashboard_url: `${config.osb.dashboardBase}/${instanceId}`
        });
      }
      return res.status(409).json({
        description: 'Instance already exists with different attributes'
      });
    }

    // Another operation in progress
    if (memoryStore.hasPendingOperation(instanceId)) {
      return res.status(422).json({
        description: 'Another operation for this service instance is in progress'
      });
    }

    // Async provisioning (preferred when enabled and requested)
    if (config.osb.enableAsync && acceptsIncomplete) {
      const operationId = `provision-${instanceId}-${Date.now()}`;

      memoryStore.setOperation(instanceId, operationId, {
        type: 'provision',
        state: 'in progress',
        description: 'Provisioning service instance'
      });

      // Kick off async job
      setTimeout(async () => {
        try {
          const radwareResult =
            await radwareApi.createAccountOrServiceForInstance({
              instanceId,
              planId: plan_id,
              parameters
            });

          // IMPORTANT: store Radware service id under a consistent key
          memoryStore.createInstance(instanceId, {
            serviceId: service_id,
            planId: plan_id,
            context,
            parameters,
            accountId: radwareResult.accountId,
            radwareServiceId: radwareResult.serviceId
          });

          memoryStore.updateOperation(
            operationId,
            'succeeded',
            'Service instance provisioned successfully'
          );
        } catch (error) {
          memoryStore.updateOperation(
            operationId,
            'failed',
            error.description || error.message
          );
        }
      }, 0);

      // OSB spec: 202 should return only "operation"
      return res.status(202).json({ operation: operationId });
    }

    // If broker requires async but client didn't opt-in
    if (config.osb.enableAsync && !acceptsIncomplete) {
      return res.status(422).json({
        error: 'AsyncRequired',
        description:
          'This service plan requires client support for asynchronous service operations.'
      });
    }

    // Synchronous provisioning
    const radwareResult = await radwareApi.createAccountOrServiceForInstance({
      instanceId,
      planId: plan_id,
      parameters
    });

    memoryStore.createInstance(instanceId, {
      serviceId: service_id,
      planId: plan_id,
      context,
      parameters,
      accountId: radwareResult.accountId,
      radwareServiceId: radwareResult.serviceId // consistent name
    });

    return res.status(201).json({
      dashboard_url: `${config.osb.dashboardBase}/${instanceId}`
    });
  } catch (error) {
    logger.error(
      {
        correlationId: req.correlationId,
        instanceId,
        error: error.message
      },
      'Provision failed'
    );

    return res.status(error.status || 500).json({
      description: error.description || error.message
    });
  }
});

/**
 * GET /v2/service_instances/:instance_id/last_operation - Operation status
 */
router.get('/service_instances/:instance_id/last_operation', (req, res) => {
  const instanceId = req.params.instance_id;
  const operation = req.query.operation;

  logger.info(
    { correlationId: req.correlationId, instanceId, operation },
    'Last operation status requested'
  );

  try {
    if (!operation) {
      return res.status(400).json({
        description: 'operation query parameter is required'
      });
    }

    const operationData = memoryStore.getOperation(operation);
    if (!operationData) {
      return res.status(404).json({ description: 'Operation not found' });
    }

    const response = { state: operationData.state };
    if (operationData.description) response.description = operationData.description;

    return res.status(200).json(response);
  } catch (error) {
    logger.error(
      { correlationId: req.correlationId, instanceId, error: error.message },
      'Last operation check failed'
    );
    return res.status(500).json({ description: 'Internal server error' });
  }
});

/**
 * PATCH /v2/service_instances/:instance_id - Update service instance
 * Calls Radware backend to apply plan changes, then updates local store.
 */
router.patch('/service_instances/:instance_id', async (req, res) => {
  const instanceId = req.params.instance_id;
  const { service_id, plan_id, context, parameters, previous_values } = req.body;

  logger.info(
    { correlationId: req.correlationId, instanceId, planId: plan_id },
    'Update request received'
  );

  try {
    const instance = memoryStore.getInstance(instanceId);
    if (!instance) {
      return res.status(404).json({ description: 'Service instance not found' });
    }

    if (memoryStore.hasPendingOperation(instanceId)) {
      return res.status(422).json({
        description: 'Another operation for this service instance is in progress'
      });
    }

    // If a plan change was requested, call Radware backend first
    if (plan_id && plan_id !== instance.planId) {
      const radwareServiceId = instance.radwareServiceId || instance.serviceId;
      if (!radwareServiceId) {
        return res.status(500).json({
          description: 'Missing Radware service id on instance record'
        });
      }

      await radwareApi.updateServicePlan({
        serviceId: radwareServiceId,
        newPlanId: plan_id,
        params: parameters || {}
      });
    }

    // Merge local state (parameters/context may be updated even without plan change)
    memoryStore.updateInstance(instanceId, {
      planId: plan_id || instance.planId,
      context: context || instance.context,
      parameters: { ...instance.parameters, ...(parameters || {}) }
    });

    return res.status(200).json({});
  } catch (error) {
    logger.error(
      { correlationId: req.correlationId, instanceId, error: error.message },
      'Update failed'
    );

    return res.status(error.status || 500).json({
      description: error.description || error.message
    });
  }
});

/**
 * DELETE /v2/service_instances/:instance_id - Deprovision service instance
 */
router.delete('/service_instances/:instance_id', async (req, res) => {
  const instanceId = req.params.instance_id;
  const acceptsIncomplete = req.query.accepts_incomplete === 'true';

  logger.info(
    { correlationId: req.correlationId, instanceId, acceptsIncomplete },
    'Deprovision request received'
  );

  try {
    const { service_id, plan_id } = req.query;
    if (!service_id || !plan_id) {
      return res.status(400).json({
        description: 'service_id and plan_id are required query parameters'
      });
    }

    const instance = memoryStore.getInstance(instanceId);
    if (!instance) {
      return res.status(410).json({});
    }

    if (instance.serviceId !== service_id || instance.planId !== plan_id) {
      return res.status(409).json({
        description: 'Mismatched service_id/plan_id for this instance'
      });
    }

    if (memoryStore.hasPendingOperation(instanceId)) {
      return res.status(422).json({
        description: 'Another operation for this service instance is in progress'
      });
    }

    if (config.osb.enableAsync && acceptsIncomplete) {
      const operationId = `deprovision-${instanceId}-${Date.now()}`;

      memoryStore.setOperation(instanceId, operationId, {
        type: 'deprovision',
        state: 'in progress',
        description: 'Deprovisioning service instance'
      });

      setTimeout(async () => {
        try {
          await radwareApi.deleteAccountOrService({
            accountId: instance.accountId,
            serviceId: instance.radwareServiceId
          });

          memoryStore.deleteInstance(instanceId);
          memoryStore.updateOperation(
            operationId,
            'succeeded',
            'Service instance deprovisioned successfully'
          );
        } catch (error) {
          memoryStore.updateOperation(
            operationId,
            'failed',
            error.description || error.message
          );
        }
      }, 0);

      return res.status(202).json({ operation: operationId });
    }

    
    await radwareApi.deleteAccountOrService({
      accountId: instance.accountId,
      serviceId: instance.radwareServiceId
    });

    memoryStore.deleteInstance(instanceId);
    return res.status(200).json({});
  } catch (error) {
    logger.error(
      { correlationId: req.correlationId, instanceId, error: error.message },
      'Deprovision failed'
    );

    return res.status(error.status || 500).json({
      description: error.description || error.message
    });
  }
});


/**
 * PUT /v2/service_instances/:instance_id/service_bindings/:binding_id - Create binding
 */
router.put(
  '/service_instances/:instance_id/service_bindings/:binding_id',
  async (req, res) => {
    const instanceId = req.params.instance_id;
    const bindingId = req.params.binding_id;
    const { service_id, plan_id, bind_resource, parameters } = req.body;

    logger.info(
      { correlationId: req.correlationId, instanceId, bindingId },
      'Bind request received'
    );

    try {
      if (!service_id || !plan_id) {
        return res.status(400).json({
          description: 'service_id and plan_id are required'
        });
      }

      const instance = memoryStore.getInstance(instanceId);
      if (!instance) {
        return res.status(404).json({ description: 'Service instance not found' });
      }

      const existingBinding = memoryStore.getBinding(bindingId);
      if (existingBinding) {
        if (
          existingBinding.serviceId === service_id &&
          existingBinding.planId === plan_id
        ) {
          return res.status(200).json({
            credentials: existingBinding.credentials
          });
        }
        return res.status(409).json({
          description: 'Binding already exists with different attributes'
        });
      }

      const email = parameters?.email;
      if (!email) {
        return res.status(422).json({
          error: 'RequiresApp',
          description:
            'This service requires email parameter for creating contact user'
        });
      }

      // Create contact user in Radware
      const contactUser = await radwareApi.createContactUser({
        accountId: instance.accountId,
        email,
        additionalData: parameters
      });

      const credentials = {
        userId: contactUser.id,
        email: contactUser.email,
        accountId: instance.accountId
      };

      memoryStore.createBinding(instanceId, bindingId, {
        serviceId: service_id,
        planId: plan_id,
        bindResource: bind_resource,
        parameters,
        credentials,
        radwareUserId: contactUser.id
      });

      return res.status(201).json({ credentials });
    } catch (error) {
      logger.error(
        {
          correlationId: req.correlationId,
          instanceId,
          bindingId,
          error: error.message
        },
        'Bind failed'
      );

      return res.status(error.status || 500).json({
        description: error.description || error.message
      });
    }
  }
);

/**
 * DELETE /v2/service_instances/:instance_id/service_bindings/:binding_id - Delete binding
 */
router.delete(
  '/service_instances/:instance_id/service_bindings/:binding_id',
  async (req, res) => {
    const instanceId = req.params.instance_id;
    const bindingId = req.params.binding_id;

    logger.info(
      { correlationId: req.correlationId, instanceId, bindingId },
      'Unbind request received'
    );

    try {
      const { service_id, plan_id } = req.query;
      if (!service_id || !plan_id) {
        return res.status(400).json({
          description: 'service_id and plan_id are required query parameters'
        });
      }

      const binding = memoryStore.getBinding(bindingId);
      if (!binding) {
        return res.status(410).json({});
      }

      if (binding.serviceId !== service_id || binding.planId !== plan_id) {
        return res.status(409).json({
          description: 'Mismatched service_id/plan_id for this binding'
        });
      }

      await radwareApi.deleteContactUser({ id: binding.radwareUserId });

      memoryStore.deleteBinding(bindingId);
      return res.status(200).json({});
    } catch (error) {
      logger.error(
        {
          correlationId: req.correlationId,
          instanceId,
          bindingId,
          error: error.message
        },
        'Unbind failed'
      );

      return res.status(error.status || 500).json({
        description: error.description || error.message
      });
    }
  }
);

module.exports = router;
