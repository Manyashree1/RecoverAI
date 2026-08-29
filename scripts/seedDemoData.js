/* Development-only deterministic demo data. */
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/database');
const Merchant = require('../src/models/Merchant');
const MerchantUser = require('../src/models/MerchantUser');
const Customer = require('../src/models/Customer');
const Payment = require('../src/models/Payment');
const RecoveryCase = require('../src/models/RecoveryCase');
const RecoveryPolicy = require('../src/models/RecoveryPolicy');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const { AuthService } = require('../src/services/authService');

const DEMO_POLICY_CONFIG = Object.freeze({
  allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT', 'PAYMENT_METHOD_UPDATE'],
  minimumRecoveryConfidence: 0.6,
  maxAutomaticRetries: 2,
  maxTransactionAmount: 1000000,
  maxCustomerContactAttempts: 1
});

const DEMO_SCENARIOS = Object.freeze([
  { id: 'temporary', amount: 499900, code: 'insufficient_funds', action: 'CUSTOMER_REMINDER', status: 'EXECUTED', fallbackUsed: true, caseStatus: 'ACTION_PENDING', recovered: false },
  { id: 'blocked', amount: 150000, code: 'card_declined', action: 'PAYMENT_METHOD_UPDATE', status: 'POLICY_BLOCKED', caseStatus: 'POLICY_BLOCKED', recovered: false },
  { id: 'limit', amount: 75000, code: 'insufficient_funds', action: 'RETRY_PAYMENT', status: 'BLOCKED', caseStatus: 'DETECTED', recovered: false },
  { id: 'failed', amount: 250000, code: 'network_error', action: 'CUSTOMER_REMINDER', status: 'FAILED', caseStatus: 'DETECTED', recovered: false },
  { id: 'recovered', amount: 350000, code: 'insufficient_funds', action: 'CUSTOMER_REMINDER', status: 'EXECUTED', caseStatus: 'RECOVERED', recovered: true, recoveredAmount: 350000 },
  { id: 'escalated', amount: 120000, code: 'fraud_suspected', action: 'ESCALATE_TO_HUMAN', status: 'EXECUTED', caseStatus: 'ACTION_PENDING', recovered: false },
  { id: 'payment_method', amount: 220000, code: 'card_expired', action: 'PAYMENT_METHOD_UPDATE', status: 'EXECUTED', caseStatus: 'ACTION_PENDING', recovered: false },
  { id: 'contact_limit', amount: 90000, code: 'insufficient_funds', action: 'CUSTOMER_REMINDER', status: 'BLOCKED', caseStatus: 'DETECTED', recovered: false }
]);

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!password) throw new Error('Set DEMO_ADMIN_PASSWORD before running the development demo seed.');
  await connectDatabase();
  try {
    const merchant = await Merchant.findOneAndUpdate(
      { name: 'RecoverAI Demo Merchant' },
      { name: 'RecoverAI Demo Merchant', status: 'ACTIVE', ...(process.env.RAZORPAY_ACCOUNT_ID ? { razorpayAccountId: process.env.RAZORPAY_ACCOUNT_ID.trim() } : {}) },
      { upsert: true, new: true }
    );
    await RecoveryPolicy.findOneAndUpdate(
      { merchant: merchant._id },
      { merchant: merchant._id, ...DEMO_POLICY_CONFIG },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const hash = await new AuthService().hashPassword(password);
    await MerchantUser.findOneAndUpdate({ email: 'demo@recoverai.test' }, { merchant: merchant._id, email: 'demo@recoverai.test', passwordHash: hash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' }, { upsert: true, new: true });
    const customer = await Customer.findOneAndUpdate({ merchant: merchant._id, externalCustomerId: 'demo_customer' }, { merchant: merchant._id, externalCustomerId: 'demo_customer', email: 'customer@demo.test', phone: '+919900000001' }, { upsert: true, new: true });

    for (const row of DEMO_SCENARIOS) {
      const payment = await Payment.findOneAndUpdate(
        { razorpayPaymentId: `demo_${row.id}` },
        { merchant: merchant._id, customer: customer._id, razorpayPaymentId: `demo_${row.id}`, amount: row.amount, currency: 'INR', status: 'FAILED', failure: { code: row.code, description: `Development demo ${row.code}` }, attemptCount: 1 },
        { upsert: true, new: true }
      );
      const recoveryCase = await RecoveryCase.findOneAndUpdate(
        { payment: payment._id },
        { merchant: merchant._id, payment: payment._id, status: row.caseStatus, retryCount: row.id === 'limit' ? 2 : 0, customerContactAttempts: row.id === 'contact_limit' ? 2 : 0, recoveredAmount: row.recovered ? row.recoveredAmount : 0, ...(row.recovered ? { resolvedAt: new Date() } : {}) },
        { upsert: true, new: true }
      );

      await resetStaleDemoRecommendation({ merchant: merchant._id, payment, recoveryCase, policy: DEMO_POLICY_CONFIG, scenarioId: row.id });

      const key = `demo:${row.id}`;
      const execution = row.recovered
        ? { provider: 'RAZORPAY_TEST', providerReference: `demo_link_${row.id}`, result: 'PAYMENT_CONFIRMED', providerPaymentId: `demo_provider_payment_${row.id}`, confirmedAt: new Date() }
        : row.status === 'EXECUTED'
          ? { provider: 'RAZORPAY_TEST', providerReference: `demo_link_${row.id}`, result: 'PAYMENT_LINK_CREATED' }
          : row.status === 'FAILED'
            ? { provider: 'RAZORPAY_TEST', result: 'PROVIDER_FAILURE', error: 'Development demo failure.' }
            : {};

      const action = await RecoveryAction.findOneAndUpdate(
        { idempotencyKey: key },
        {
          merchant: merchant._id,
          payment: payment._id,
          recoveryCase: recoveryCase._id,
          type: row.action,
          status: row.status,
          recommendation: { source: row.fallbackUsed || row.id === 'failed' || row.id === 'contact_limit' ? 'SYSTEM' : 'AI_AGENT', confidence: 0.8, rationale: 'Development-only deterministic demo scenario.' },
          policyDecision: {
            decision: ['POLICY_BLOCKED', 'BLOCKED'].includes(row.status) ? 'BLOCKED' : 'ALLOWED',
            reason: row.id === 'limit' ? 'Maximum automatic retry count reached.' : row.id === 'contact_limit' ? 'Maximum customer contact attempts reached.' : 'Development demo.',
            evaluatedAt: new Date()
          },
          idempotencyKey: key,
          execution
        },
        { upsert: true, new: true }
      );

      const eventType = row.status === 'FAILED' ? 'ACTION_EXECUTION_FAILED' : row.status === 'EXECUTED' ? 'ACTION_EXECUTION_COMPLETED' : 'POLICY_EVALUATED';
      const eventId = demoProviderEventId(row.id, eventType);
      const existingEvent = await findExistingDemoEvent({ merchant: merchant._id, action, type: eventType, providerEventId: eventId });
      if (!existingEvent) {
        await AuditEvent.create({
          merchant: merchant._id,
          payment: payment._id,
          recoveryCase: recoveryCase._id,
          recoveryAction: action._id,
          providerEventId: eventId,
          type: eventType,
          actor: 'SYSTEM',
          reason: 'Development demo audit event.'
        });
      }

      if (row.fallbackUsed) {
        const fallbackEventId = demoProviderEventId(row.id, 'AI_FALLBACK_USED');
        const fallbackEvent = await findExistingDemoEvent({ merchant: merchant._id, action, type: 'AI_FALLBACK_USED', providerEventId: fallbackEventId });
        if (!fallbackEvent) {
          await AuditEvent.create({
            merchant: merchant._id,
            payment: payment._id,
            recoveryCase: recoveryCase._id,
            recoveryAction: action._id,
            providerEventId: fallbackEventId,
            type: 'AI_FALLBACK_USED',
            actor: 'SYSTEM',
            reason: 'Development demo fallback scenario.'
          });
        }
      }

      if (row.recovered) {
        const recoveryEventId = demoProviderEventId(row.id, 'RECOVERY_COMPLETED');
        const existingRecoveryEvent = await findExistingDemoEvent({ merchant: merchant._id, action, type: 'RECOVERY_COMPLETED', providerEventId: recoveryEventId });
        if (!existingRecoveryEvent) {
          await AuditEvent.create({
            merchant: merchant._id,
            payment: payment._id,
            recoveryCase: recoveryCase._id,
            recoveryAction: action._id,
            providerEventId: recoveryEventId,
            type: 'RECOVERY_COMPLETED',
            actor: 'RAZORPAY',
            action: row.action,
            reason: 'Razorpay confirmed payment for the RecoverAI Payment Link.',
            result: 'PAYMENT_CONFIRMED',
            metadata: { provider: 'RAZORPAY', providerPaymentId: `demo_provider_payment_${row.id}`, providerLinkId: `demo_link_${row.id}`, amount: row.recoveredAmount, currency: 'INR' }
          });
        }
      }
    }

    const recoveredCases = DEMO_SCENARIOS.filter((s) => s.recovered);
    const recoveredRevenue = recoveredCases.reduce((sum, s) => sum + (s.recoveredAmount || 0), 0);
    console.log(`Development demo data ready. ${recoveredCases.length} recovered case(s), ₹${recoveredRevenue} recovered revenue.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error('Demo seed failed:', error.message); process.exitCode = 1; });
}

module.exports = { DEMO_POLICY_CONFIG, DEMO_SCENARIOS };

async function resetStaleDemoRecommendation({ merchant, payment, recoveryCase, policy, scenarioId }) {
  if (scenarioId !== 'limit') return;
  const staleActions = await RecoveryAction.find({
    merchant,
    payment,
    type: 'CUSTOMER_REMINDER',
    status: { $in: ['POLICY_BLOCKED', 'POLICY_ALLOWED'] },
    'recommendation.confidence': 0.6,
    'execution.providerReference': { $exists: false }
  }).select('_id type recommendation');
  if (!staleActions.length) return;
  for (const action of staleActions) {
    const policyDecision = evaluateRecoveryAction({
      policy,
      payment,
      recoveryCase,
      recommendation: { type: action.type, confidence: action.recommendation.confidence }
    });
    await RecoveryAction.updateOne(
      { _id: action._id },
      {
        $set: {
          status: policyDecision.allowed ? 'POLICY_ALLOWED' : 'POLICY_BLOCKED',
          policyDecision: { decision: policyDecision.decision, reason: policyDecision.reason, evaluatedAt: new Date() },
          idempotencyKey: `${recoveryCase._id}:CUSTOMER_REMINDER:retry${recoveryCase.retryCount}:contact${recoveryCase.customerContactAttempts}`
        }
      }
    );
  }
}

function demoProviderEventId(scenarioId, eventType) {
  return `demo:${scenarioId}:${eventType}`;
}

function findExistingDemoEvent({ merchant, action, type, providerEventId }) {
  return AuditEvent.findOne({
    merchant,
    type,
    $or: [
      { providerEventId },
      { recoveryAction: action._id, providerEventId: { $exists: false } },
      { recoveryAction: action._id, providerEventId: null }
    ]
  });
}
