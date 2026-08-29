const mongoose = require('mongoose');
const { RECOVERY_ACTION_TYPE } = require('../constants/enums');

const POLICY_BOUNDS = Object.freeze({
  maxAutomaticRetries: { min: 0, max: 10 },
  maxCustomerContactAttempts: { min: 0, max: 10 },
  cooldownMinutes: { min: 0, max: 10080 },
  escalationCooldownMinutes: { min: 0, max: 43200 },
  maxTransactionAmount: { min: 1, max: 100000000 },
  minimumRecoveryConfidence: { min: 0, max: 1 }
});

const recoveryPolicySchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, unique: true, index: true },
    maxAutomaticRetries: { type: Number, required: true, default: 2, min: 0 },
    maxTransactionAmount: { type: Number, required: true, default: 1000000, min: 1 },
    allowedActions: {
      type: [{ type: String, enum: Object.values(RECOVERY_ACTION_TYPE) }],
      default: [RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER, RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN, RECOVERY_ACTION_TYPE.NO_ACTION]
    },
    minimumRecoveryConfidence: { type: Number, required: true, default: 0.7, min: 0, max: 1 },
    maxCustomerContactAttempts: { type: Number, required: true, default: 1, min: 0 },
    cooldownMinutes: { type: Number, required: true, default: 60, min: 0 },
    escalationCooldownMinutes: { type: Number, required: true, default: 1440, min: 0 },
    version: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
);

const RecoveryPolicy = mongoose.model('RecoveryPolicy', recoveryPolicySchema);

module.exports = { RecoveryPolicy, POLICY_BOUNDS };

