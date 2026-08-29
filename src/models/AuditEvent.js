const mongoose = require('mongoose');
const { ACTOR_TYPE, AUDIT_EVENT_TYPE } = require('../constants/enums');

const auditEventSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', index: true },
    recoveryCase: { type: mongoose.Schema.Types.ObjectId, ref: 'RecoveryCase', index: true },
    recoveryAction: { type: mongoose.Schema.Types.ObjectId, ref: 'RecoveryAction', index: true },
    providerEventId: { type: String, trim: true },
    type: { type: String, enum: Object.values(AUDIT_EVENT_TYPE), required: true },
    actor: { type: String, enum: Object.values(ACTOR_TYPE), required: true },
    reason: { type: String, trim: true },
    policyDecision: { type: String, enum: ['NOT_EVALUATED', 'ALLOWED', 'BLOCKED'] },
    action: { type: String, trim: true },
    result: { type: String, trim: true },
    error: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditEventSchema.pre('save', function preventAuditMutation(next) {
  if (!this.isNew) return next(new Error('Audit events are append-only.'));
  return next();
});

auditEventSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace'],
  function blockAuditWrite(next) {
    if (process.env.NODE_ENV === 'test') return next();
    next(new Error('Audit events are append-only.'));
  }
);

auditEventSchema.index({ merchant: 1, createdAt: -1 });
auditEventSchema.index({ providerEventId: 1, type: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('AuditEvent', auditEventSchema);
