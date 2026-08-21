const mongoose = require('mongoose');

const merchantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    // A provider account must resolve to exactly one merchant for webhook
    // routing. Sparse permits merchants before Razorpay is configured.
    razorpayAccountId: { type: String, trim: true, unique: true, sparse: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Merchant', merchantSchema);
