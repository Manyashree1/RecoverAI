const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    externalCustomerId: { type: String, trim: true },
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true }
  },
  { timestamps: true }
);

customerSchema.index({ merchant: 1, externalCustomerId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Customer', customerSchema);

