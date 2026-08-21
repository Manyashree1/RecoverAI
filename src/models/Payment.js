const mongoose = require('mongoose');
const { PAYMENT_STATUS } = require('../constants/enums');

const paymentSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    razorpayPaymentId: { type: String, trim: true, unique: true, sparse: true },
    razorpayOrderId: { type: String, trim: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, default: 'INR', uppercase: true, trim: true },
    status: { type: String, enum: Object.values(PAYMENT_STATUS), required: true, default: PAYMENT_STATUS.CREATED },
    failure: {
      code: { type: String, trim: true },
      description: { type: String, trim: true },
      occurredAt: { type: Date }
    },
    attemptCount: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

paymentSchema.index({ merchant: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);

