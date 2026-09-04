const mongoose = require('mongoose');

const merchantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: false, trim: true, lowercase: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    // A provider account must resolve to exactly one merchant for webhook
    // routing. Sparse permits merchants before Razorpay is configured.
    razorpayAccountId: { type: String, trim: true, unique: true, sparse: true }
  },
  { timestamps: true }
);

merchantSchema.index({ slug: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Merchant', merchantSchema);
