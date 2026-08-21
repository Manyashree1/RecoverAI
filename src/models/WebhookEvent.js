const mongoose = require('mongoose');
const { WEBHOOK_EVENT_STATUS } = require('../constants/enums');

/**
 * Delivery ledger for untrusted provider events. We retain identifiers and
 * processing state, not the raw payload, to minimise retained payment PII.
 */
const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['RAZORPAY'], required: true },
    providerEventId: { type: String, required: true, trim: true },
    providerEventType: { type: String, required: true, trim: true },
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', index: true },
    status: { type: String, enum: Object.values(WEBHOOK_EVENT_STATUS), default: WEBHOOK_EVENT_STATUS.RECEIVED },
    processedAt: { type: Date }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

webhookEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });
webhookEventSchema.index({ merchant: 1, createdAt: -1 });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);

