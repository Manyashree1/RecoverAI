/* Development-only deterministic demo data. It deliberately creates no RECOVERED case or recovery revenue: provider-confirmed Payment Link outcome ingestion is not implemented yet. */
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/database');
const Merchant = require('../src/models/Merchant');
const MerchantUser = require('../src/models/MerchantUser');
const Customer = require('../src/models/Customer');
const Payment = require('../src/models/Payment');
const RecoveryCase = require('../src/models/RecoveryCase');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const { AuthService } = require('../src/services/authService');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!password) throw new Error('Set DEMO_ADMIN_PASSWORD before running the development demo seed.');
  await connectDatabase();
  try {
    const merchant = await Merchant.findOneAndUpdate({ name: 'RecoverAI Demo Merchant' }, { name: 'RecoverAI Demo Merchant', status: 'ACTIVE' }, { upsert: true, new: true });
    const hash = await new AuthService().hashPassword(password);
    await MerchantUser.findOneAndUpdate({ email: 'demo@recoverai.test' }, { merchant: merchant._id, email: 'demo@recoverai.test', passwordHash: hash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' }, { upsert: true, new: true });
    const customer = await Customer.findOneAndUpdate({ merchant: merchant._id, externalCustomerId: 'demo_customer' }, { merchant: merchant._id, externalCustomerId: 'demo_customer', email: 'customer@demo.test', phone: '+919900000001' }, { upsert: true, new: true });
    for (const row of [{ id: 'temporary', amount: 499900, code: 'insufficient_funds', action: 'CUSTOMER_REMINDER', status: 'EXECUTED' }, { id: 'blocked', amount: 150000, code: 'card_declined', action: 'PAYMENT_METHOD_UPDATE', status: 'POLICY_BLOCKED' }, { id: 'limit', amount: 75000, code: 'insufficient_funds', action: 'RETRY_PAYMENT', status: 'BLOCKED' }, { id: 'failed', amount: 250000, code: 'network_error', action: 'CUSTOMER_REMINDER', status: 'FAILED' }]) {
      const payment = await Payment.findOneAndUpdate({ razorpayPaymentId: `demo_${row.id}` }, { merchant: merchant._id, customer: customer._id, razorpayPaymentId: `demo_${row.id}`, amount: row.amount, currency: 'INR', status: 'FAILED', failure: { code: row.code, description: `Development demo ${row.code}` }, attemptCount: 1 }, { upsert: true, new: true });
      const recoveryCase = await RecoveryCase.findOneAndUpdate({ payment: payment._id }, { merchant: merchant._id, payment: payment._id, status: row.status === 'EXECUTED' ? 'ACTION_PENDING' : 'DETECTED', retryCount: row.id === 'limit' ? 2 : 0, customerContactAttempts: row.status === 'EXECUTED' ? 1 : 0, recoveredAmount: 0 }, { upsert: true, new: true });
      const key = `demo:${row.id}`;
      const action = await RecoveryAction.findOneAndUpdate({ idempotencyKey: key }, { merchant: merchant._id, payment: payment._id, recoveryCase: recoveryCase._id, type: row.action, status: row.status, recommendation: { source: row.id === 'failed' ? 'SYSTEM' : 'AI_AGENT', confidence: 0.8, rationale: 'Development-only deterministic demo scenario.' }, policyDecision: { decision: row.status === 'POLICY_BLOCKED' || row.status === 'BLOCKED' ? 'BLOCKED' : 'ALLOWED', reason: 'Development demo.' }, idempotencyKey: key, execution: row.status === 'EXECUTED' ? { provider: 'RAZORPAY_TEST', providerReference: 'demo_link_not_paid', result: 'PAYMENT_LINK_CREATED' } : row.status === 'FAILED' ? { provider: 'RAZORPAY_TEST', result: 'PROVIDER_FAILURE', error: 'Development demo failure.' } : {} }, { upsert: true, new: true });
      const eventType = row.status === 'FAILED' ? 'ACTION_EXECUTION_FAILED' : row.status === 'EXECUTED' ? 'ACTION_EXECUTION_COMPLETED' : 'POLICY_EVALUATED';
      const existingEvent = await AuditEvent.findOne({ merchant: merchant._id, recoveryAction: action._id, type: eventType });
      if (!existingEvent) await AuditEvent.create({ merchant: merchant._id, payment: payment._id, recoveryCase: recoveryCase._id, recoveryAction: action._id, type: eventType, actor: 'SYSTEM', reason: 'Development demo audit event.' });
    }
    console.log('Development demo data ready. No recovered revenue was seeded.');
  } finally { await mongoose.disconnect(); }
}
main().catch((error) => { console.error('Demo seed failed:', error.message); process.exitCode = 1; });
