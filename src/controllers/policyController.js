const { randomUUID } = require('crypto');
const { AppError } = require('../utils/AppError');
const { RecoveryPolicy, POLICY_BOUNDS } = require('../models/RecoveryPolicy');
const { MongoTransactionRunner } = require('../services/mongoTransactionRunner');
const AuditEvent = require('../models/AuditEvent');
const { toPublicJSON } = require('../utils/serialize');
const { RECOVERY_ACTION_TYPE, AUDIT_EVENT_TYPE, ACTOR_TYPE } = require('../constants/enums');

const WRITABLE_FIELDS = ['maxAutomaticRetries', 'maxCustomerContactAttempts', 'cooldownMinutes', 'escalationCooldownMinutes', 'allowedActions'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePolicyUpdate(input) {
  if (!isPlainObject(input)) {
    throw new AppError('Invalid policy payload.', 400);
  }

  const errors = [];
  const allowedFields = [...WRITABLE_FIELDS, 'expectedVersion'];

  for (const key of Object.keys(input)) {
    if (!allowedFields.includes(key)) {
      errors.push(`Unknown field: ${key}`);
    }
  }

  const update = {};

  if ('maxAutomaticRetries' in input) {
    const value = input.maxAutomaticRetries;
    if (!Number.isInteger(value) || value < POLICY_BOUNDS.maxAutomaticRetries.min || value > POLICY_BOUNDS.maxAutomaticRetries.max) {
      errors.push(`maxAutomaticRetries must be an integer between ${POLICY_BOUNDS.maxAutomaticRetries.min} and ${POLICY_BOUNDS.maxAutomaticRetries.max}.`);
    } else {
      update.maxAutomaticRetries = value;
    }
  }

  if ('maxCustomerContactAttempts' in input) {
    const value = input.maxCustomerContactAttempts;
    if (!Number.isInteger(value) || value < POLICY_BOUNDS.maxCustomerContactAttempts.min || value > POLICY_BOUNDS.maxCustomerContactAttempts.max) {
      errors.push(`maxCustomerContactAttempts must be an integer between ${POLICY_BOUNDS.maxCustomerContactAttempts.min} and ${POLICY_BOUNDS.maxCustomerContactAttempts.max}.`);
    } else {
      update.maxCustomerContactAttempts = value;
    }
  }

  if ('cooldownMinutes' in input) {
    const value = input.cooldownMinutes;
    if (!Number.isInteger(value) || value < POLICY_BOUNDS.cooldownMinutes.min || value > POLICY_BOUNDS.cooldownMinutes.max) {
      errors.push(`cooldownMinutes must be an integer between ${POLICY_BOUNDS.cooldownMinutes.min} and ${POLICY_BOUNDS.cooldownMinutes.max}.`);
    } else {
      update.cooldownMinutes = value;
    }
  }

  if ('escalationCooldownMinutes' in input) {
    const value = input.escalationCooldownMinutes;
    if (!Number.isInteger(value) || value < POLICY_BOUNDS.escalationCooldownMinutes.min || value > POLICY_BOUNDS.escalationCooldownMinutes.max) {
      errors.push(`escalationCooldownMinutes must be an integer between ${POLICY_BOUNDS.escalationCooldownMinutes.min} and ${POLICY_BOUNDS.escalationCooldownMinutes.max}.`);
    } else {
      update.escalationCooldownMinutes = value;
    }
  }

  if ('allowedActions' in input) {
    const value = input.allowedActions;
    if (!Array.isArray(value) || value.length === 0) {
      errors.push('allowedActions must be a non-empty array.');
    } else {
      const validActions = Object.values(RECOVERY_ACTION_TYPE);
      const deduped = [...new Set(value)];
      const invalid = deduped.filter((action) => !validActions.includes(action));
      if (invalid.length > 0) {
        errors.push(`allowedActions contains unsupported values: ${invalid.join(', ')}.`);
      } else if (deduped.length !== value.length) {
        errors.push('allowedActions must not contain duplicates.');
      } else {
        update.allowedActions = deduped;
      }
    }
  }

  const expectedVersion = input.expectedVersion;
  if (expectedVersion !== undefined) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      errors.push('expectedVersion must be a non-negative integer.');
    }
  }

  if (WRITABLE_FIELDS.every((field) => !(field in input))) {
    errors.push(`At least one of ${WRITABLE_FIELDS.join(', ')} must be provided.`);
  }

  if (errors.length > 0) {
    throw new AppError('Policy validation failed.', 400, errors);
  }

  return { update, expectedVersion };
}

function sanitizeForAudit(policy) {
  return {
    maxAutomaticRetries: policy.maxAutomaticRetries,
    maxCustomerContactAttempts: policy.maxCustomerContactAttempts,
    cooldownMinutes: policy.cooldownMinutes,
    escalationCooldownMinutes: policy.escalationCooldownMinutes,
    allowedActions: policy.allowedActions,
    version: policy.version
  };
}

function buildAuditEventDoc(merchantId, previousSnapshot, newSnapshot, changedFields) {
  return {
    merchant: merchantId,
    type: AUDIT_EVENT_TYPE.POLICY_UPDATED,
    actor: ACTOR_TYPE.MERCHANT_ADMIN,
    reason: 'Merchant recovery policy updated.',
    providerEventId: `policy:${merchantId}:${randomUUID()}`,
    metadata: {
      previous: previousSnapshot,
      current: newSnapshot,
      changedFields
    }
  };
}

function createPolicyController({ transactionRunner = new MongoTransactionRunner() } = {}) {
  return {
    async get(req, res, next) {
      try {
        const policy = await RecoveryPolicy.findOne({ merchant: req.auth.merchantId }).lean();
        if (!policy) {
          const fresh = await RecoveryPolicy.create([{ merchant: req.auth.merchantId }]);
          return res.status(200).json({ data: toPublicJSON(fresh[0]) });
        }
        return res.status(200).json({ data: toPublicJSON(policy) });
      } catch (error) {
        return next(error);
      }
    },

    async update(req, res, next) {
      try {
        const { update, expectedVersion } = normalizePolicyUpdate(req.body);

        const result = await transactionRunner.run(async (session) => {
          const baseQuery = { merchant: req.auth.merchantId };
          if (expectedVersion !== undefined) {
            baseQuery.version = expectedVersion;
          }

          const query = RecoveryPolicy.findOne(baseQuery);
          if (session) query.session(session);
          const current = await query;

          if (!current) {
            if (expectedVersion !== undefined) {
              const existingQuery = RecoveryPolicy.findOne({ merchant: req.auth.merchantId });
              if (session) existingQuery.session(session);
              const existing = await existingQuery.lean();
              if (existing) {
                const conflict = new AppError(
                  'Policy was modified elsewhere. Refresh and try again.',
                  409
                );
                conflict.details = { currentVersion: existing.version };
                throw conflict;
              }
            }
            throw new AppError('Policy not found.', 404);
          }

          const previousSnapshot = sanitizeForAudit(current);

          const updatePayload = { ...update, version: current.version + 1 };
          const updateQuery = RecoveryPolicy.findOneAndUpdate(
            baseQuery,
            updatePayload,
            { new: true }
          );
          if (session) updateQuery.session(session);
          const updated = await updateQuery;

          if (!updated) {
            const existingQuery = RecoveryPolicy.findOne({ merchant: req.auth.merchantId });
            if (session) existingQuery.session(session);
            const existing = await existingQuery.lean();
            if (existing) {
              const conflict = new AppError(
                'Policy was modified elsewhere. Refresh and try again.',
                409
              );
              conflict.details = { currentVersion: existing.version };
              throw conflict;
            }
            throw new AppError('Policy not found.', 404);
          }

          const newSnapshot = sanitizeForAudit(updated);
          const auditDoc = buildAuditEventDoc(req.auth.merchantId, previousSnapshot, newSnapshot, Object.keys(update));
          await AuditEvent.create([auditDoc], session ? { session } : undefined);

          return updated;
        });

        return res.status(200).json({ data: toPublicJSON(result) });
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = {
  createPolicyController,
  normalizePolicyUpdate,
  POLICY_BOUNDS,
  buildAuditEventDoc,
  WRITABLE_FIELDS
};
