const mongoose = require('mongoose');
const { RECOVERY_CASE_STATUS } = require('../constants/enums');

const recoveryCaseSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
    status: { type: String, enum: Object.values(RECOVERY_CASE_STATUS), default: RECOVERY_CASE_STATUS.DETECTED },
    diagnosis: {
      category: { type: String, trim: true },
      explanation: { type: String, trim: true },
      confidence: { type: Number, min: 0, max: 1 }
    },
    retryCount: { type: Number, default: 0, min: 0 },
    customerContactAttempts: { type: Number, default: 0, min: 0 },
    recoveredAmount: { type: Number, default: 0, min: 0 },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);

recoveryCaseSchema.index({ merchant: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('RecoveryCase', recoveryCaseSchema);

