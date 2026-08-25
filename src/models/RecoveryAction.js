const mongoose = require('mongoose');
const {
  RECOVERY_ACTION_TYPE,
  RECOVERY_ACTION_STATUS,
  POLICY_DECISION
} = require('../constants/enums');

const recoveryActionSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    recoveryCase: { type: mongoose.Schema.Types.ObjectId, ref: 'RecoveryCase', required: true, index: true },
    type: { type: String, enum: Object.values(RECOVERY_ACTION_TYPE), required: true },
    status: { type: String, enum: Object.values(RECOVERY_ACTION_STATUS), default: RECOVERY_ACTION_STATUS.RECOMMENDED },
    recommendation: {
      source: { type: String, enum: ['AI_AGENT', 'MERCHANT_ADMIN', 'SYSTEM'], required: true },
      confidence: { type: Number, required: true, min: 0, max: 1 },
      rationale: { type: String, required: true, trim: true },
      model: { type: String, trim: true }
    },
    policyDecision: {
      decision: { type: String, enum: Object.values(POLICY_DECISION), default: POLICY_DECISION.NOT_EVALUATED },
      reason: { type: String, trim: true },
      evaluatedAt: { type: Date }
    },
    idempotencyKey: { type: String, required: true, trim: true, unique: true },
    execution: {
      provider: { type: String, enum: ['RAZORPAY_TEST', 'WORKFLOW'], default: 'WORKFLOW' },
      providerReference: { type: String, trim: true },
      shortUrl: { type: String, trim: true },
      providerStatus: { type: String, trim: true },
      providerPaymentId: { type: String, trim: true },
      idempotencyKey: { type: String, trim: true },
      result: { type: String, trim: true },
      error: { type: String, trim: true },
      executedAt: { type: Date },
      confirmedAt: { type: Date }
    }
  },
  { timestamps: true }
);

recoveryActionSchema.index({ recoveryCase: 1, createdAt: -1 });
recoveryActionSchema.index({ 'execution.idempotencyKey': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('RecoveryAction', recoveryActionSchema);
