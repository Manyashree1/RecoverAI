/**
 * One-off local/dev helper to create a Merchant and its first
 * MERCHANT_ADMIN login. There is deliberately no public self-registration
 * endpoint -- merchant onboarding is an operational action, not something
 * an unauthenticated client should be able to trigger.
 *
 * Usage:
 *   node scripts/seedMerchantAdmin.js "Acme Test Merchant" admin@acme.test "a-strong-password" [razorpayAccountId]
 */
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/database');
const Merchant = require('../src/models/Merchant');
const MerchantUser = require('../src/models/MerchantUser');
const { AuthService } = require('../src/services/authService');

async function main() {
  const [merchantName, email, password, razorpayAccountId] = process.argv.slice(2);
  if (!merchantName || !email || !password) {
    console.error('Usage: node scripts/seedMerchantAdmin.js "<merchant name>" <email> <password> [razorpayAccountId]');
    process.exitCode = 1;
    return;
  }

  await connectDatabase();
  const authService = new AuthService();

  try {
    const merchant = await Merchant.findOneAndUpdate(
      { name: merchantName },
      { name: merchantName, status: 'ACTIVE', ...(razorpayAccountId ? { razorpayAccountId } : {}) },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const passwordHash = await authService.hashPassword(password);
    const user = await MerchantUser.findOneAndUpdate(
      { email: email.trim().toLowerCase() },
      { merchant: merchant._id, email: email.trim().toLowerCase(), passwordHash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`Merchant ready: ${merchant._id} (${merchant.name})`);
    console.log(`MerchantUser ready: ${user._id} (${user.email})`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exitCode = 1;
});
