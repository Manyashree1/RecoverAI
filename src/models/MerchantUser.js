const mongoose = require('mongoose');
const { USER_ROLE } = require('../constants/enums');

/**
 * A login identity scoped to exactly one Merchant. Kept separate from
 * Merchant itself so a merchant can (later) have more than one user without
 * reshaping the Merchant document, and so the password hash never travels
 * with general merchant data.
 */
const merchantUserSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: Object.values(USER_ROLE), required: true, default: USER_ROLE.MERCHANT_ADMIN },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
  },
  { timestamps: true }
);

// Emails are unique system-wide (not just per-merchant) because login looks
// a user up by email alone, before the merchant is known.
merchantUserSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('MerchantUser', merchantUserSchema);
