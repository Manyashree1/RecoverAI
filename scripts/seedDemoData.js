/* Development-only deterministic demo data. */
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/database');
const Merchant = require('../src/models/Merchant');
const MerchantUser = require('../src/models/MerchantUser');
const Customer = require('../src/models/Customer');
const Payment = require('../src/models/Payment');
const RecoveryCase = require('../src/models/RecoveryCase');
const {RecoveryPolicy} = require('../src/models/RecoveryPolicy');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const { AuthService } = require('../src/services/authService');
const { analyzeRecoveryCase } = require('../src/services/recoveryIntelligenceService');
const { evaluateRecoveryAction } = require('../src/services/policyEngine');
const { hasRecoveryEvidence } = require('../src/services/analyticsService');

const DEMO_POLICY_CONFIG = Object.freeze({
  allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT', 'PAYMENT_METHOD_UPDATE'],
  minimumRecoveryConfidence: 0.6,
  maxAutomaticRetries: 2,
  maxTransactionAmount: 1000000,
  maxCustomerContactAttempts: 1,
  cooldownMinutes: 0
});

const DEMO_SCENARIOS = Object.freeze([
  { id: 'temporary_01', amount: 499900, code: 'insufficient_funds', retryCount: 2, contactCount: 0 },
  { id: 'temporary_02', amount: 120000, code: 'insufficient_funds', retryCount: 2, contactCount: 0 },
  { id: 'temporary_03', amount: 275000, code: 'insufficient_funds', retryCount: 0, contactCount: 0 },
  { id: 'temporary_04', amount: 850000, code: 'insufficient_funds', retryCount: 1, contactCount: 1 },
  { id: 'temporary_05', amount: 4999, code: 'insufficient_funds', retryCount: 2, contactCount: 0 },

  { id: 'payment_method_01', amount: 850000, code: 'expired_card', retryCount: 0, contactCount: 0 },
  { id: 'payment_method_02', amount: 220000, code: 'expired_card', retryCount: 0, contactCount: 0 },
  { id: 'payment_method_03', amount: 640000, code: 'card_declined', retryCount: 0, contactCount: 0 },

  { id: 'fraud_01', amount: 350000, code: 'fraud_suspected', retryCount: 0, contactCount: 0 },
  { id: 'fraud_02', amount: 1200000, code: 'fraud_suspected', retryCount: 0, contactCount: 0 },

  { id: 'retry_limit_01', amount: 75000, code: 'insufficient_funds', retryCount: 2, contactCount: 0 },
  { id: 'retry_limit_02', amount: 150000, code: 'insufficient_funds', retryCount: 2, contactCount: 0 },

  { id: 'contact_fatigue_01', amount: 90000, code: 'insufficient_funds', retryCount: 0, contactCount: 2 },
  { id: 'contact_fatigue_02', amount: 180000, code: 'insufficient_funds', retryCount: 0, contactCount: 2 },

  { id: 'network_error_01', amount: 250000, code: 'network_error', retryCount: 0, contactCount: 0, historicalStatus: 'FAILED' },
  { id: 'network_error_02', amount: 450000, code: 'network_error', retryCount: 1, contactCount: 0 },

  { id: 'unknown_01', amount: 60000, code: 'unknown', retryCount: 0, contactCount: 0 },
  { id: 'unknown_02', amount: 300000, code: 'unknown', retryCount: 0, contactCount: 0 },

  { id: 'cooldown_01', amount: 180000, code: 'insufficient_funds', retryCount: 0, contactCount: 0 },

  { id: 'high_value_01', amount: 8500000, code: 'insufficient_funds', retryCount: 0, contactCount: 0 },

  { id: 'policy_block_01', amount: 200000, code: 'card_declined', retryCount: 0, contactCount: 0 }
]);

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!password) throw new Error('Set DEMO_ADMIN_PASSWORD before running the development demo seed.');
  await connectDatabase();
  try {
    const DEMO_SLUG = 'recoverai-demo';
    const DEMO_NAME = 'RecoverAI Demo Merchant';
    const DEMO_EMAIL = 'demo@recoverai.test';

    let merchant = await Merchant.findOne({ slug: DEMO_SLUG }).lean();
    if (!merchant) {
      const byName = await Merchant.find({ name: DEMO_NAME }).lean();
      if (byName.length > 1) {
        throw new Error(`Multiple merchants named "${DEMO_NAME}" found. Resolve duplicates before seeding.`);
      }
      if (byName.length === 1) {
        merchant = byName[0];
        await Merchant.updateOne({ _id: merchant._id }, { slug: DEMO_SLUG });
      }
    }
    if (!merchant) {
      merchant = await Merchant.create({ slug: DEMO_SLUG, name: DEMO_NAME, status: 'ACTIVE' });
    }

    const merchantId = merchant._id;

    await RecoveryPolicy.findOneAndUpdate(
      { merchant: merchantId },
      { merchant: merchantId, ...DEMO_POLICY_CONFIG },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const existingUser = await MerchantUser.findOne({ email: DEMO_EMAIL }).lean();
    if (existingUser && String(existingUser.merchant) !== String(merchantId)) {
      throw new Error(`Demo user ${DEMO_EMAIL} is linked to merchant ${existingUser.merchant}, expected ${merchantId}. Merchant identity conflict.`);
    }

    const hash = await new AuthService().hashPassword(password);
    await MerchantUser.findOneAndUpdate({ email: DEMO_EMAIL }, { merchant: merchantId, email: DEMO_EMAIL, passwordHash: hash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' }, { upsert: true, new: true });
    const customer = await Customer.findOneAndUpdate({ merchant: merchantId, externalCustomerId: 'demo_customer' }, { merchant: merchantId, externalCustomerId: 'demo_customer', email: 'customer@demo.test', phone: '+919900000001' }, { upsert: true, new: true });

    let processed = 0;
    let created = 0;
    let reconciled = 0;
    let preservedRecoveries = 0;
    let seedCreatedRecoveredRevenue = 0;
    let existingRecoveredRevenuePreserved = 0;

    for (const row of DEMO_SCENARIOS) {
      processed += 1;
      const existingPayment = await Payment.findOne({ merchant: merchant._id, razorpayPaymentId: `demo_${row.id}` }).lean();
      if (existingPayment) {
        const existingCase = await RecoveryCase.findOne({ merchant: merchant._id, payment: existingPayment._id }).lean();
        if (existingCase) {
          const [existingActions, existingAuditEvents] = await Promise.all([
            RecoveryAction.find({ merchant: merchant._id, recoveryCase: existingCase._id }).lean(),
            AuditEvent.find({ merchant: merchant._id, recoveryCase: existingCase._id }).lean()
          ]);
          if (isGenuinelyRecoveredDemoCase(existingCase, existingActions, existingAuditEvents)) {
            preservedRecoveries += 1;
            existingRecoveredRevenuePreserved += existingCase.recoveredAmount || 0;
            console.log(`Skipped demo_${row.id}: already genuinely recovered, preserving evidence.`);
            continue;
          }
        }
      }

      if (!existingPayment) {
        created += 1;
      } else {
        reconciled += 1;
      }

      const payment = await Payment.findOneAndUpdate(
        { merchant: merchant._id, razorpayPaymentId: `demo_${row.id}` },
        { merchant: merchant._id, customer: customer._id, razorpayPaymentId: `demo_${row.id}`, amount: row.amount, currency: 'INR', status: 'FAILED', failure: { code: row.code, description: `Development demo ${row.code}` }, attemptCount: 1 },
        { upsert: true, new: true }
      );
      const recoveryCase = await RecoveryCase.findOneAndUpdate(
        { merchant: merchant._id, payment: payment._id },
        { merchant: merchant._id, payment: payment._id, status: 'DETECTED', retryCount: row.retryCount || 0, customerContactAttempts: row.contactCount || 0, recoveredAmount: 0 },
        { upsert: true, new: true }
      );

      const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy: DEMO_POLICY_CONFIG });
      const policyResult = evaluateRecoveryAction({
        policy: DEMO_POLICY_CONFIG,
        payment,
        recoveryCase,
        recommendation: { type: recommendation.action, confidence: recommendation.confidence },
        existingActions: []
      });

      const actionType = recommendation.action;
      const baseStatus = policyResult.allowed ? 'POLICY_ALLOWED' : 'POLICY_BLOCKED';
      const actionStatus = row.historicalStatus || baseStatus;

      const key = `demo:${row.id}`;
      const action = await RecoveryAction.findOneAndUpdate(
        { idempotencyKey: key },
        {
          merchant: merchant._id,
          payment: payment._id,
          recoveryCase: recoveryCase._id,
          type: actionType,
          status: actionStatus,
          recommendation: { source: 'SYSTEM', confidence: recommendation.confidence, rationale: 'Development-only deterministic demo scenario.' },
          policyDecision: {
            decision: policyResult.allowed ? 'ALLOWED' : 'BLOCKED',
            reason: policyResult.reason,
            evaluatedAt: new Date(),
            escalate: policyResult.escalate
          },
          idempotencyKey: key
        },
        { upsert: true, new: true }
      );

      const eventType = actionStatus === 'FAILED' ? 'ACTION_EXECUTION_FAILED' : actionStatus === 'POLICY_BLOCKED' ? 'POLICY_EVALUATED' : 'ACTION_RECOMMENDED';
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
          reason: eventType === 'ACTION_RECOMMENDED' ? recommendation.reason : policyResult.reason,
          action: actionType,
          policyDecision: policyResult.allowed ? 'ALLOWED' : 'BLOCKED',
          result: eventType === 'ACTION_EXECUTION_FAILED' ? 'FAILED' : eventType === 'POLICY_EVALUATED' ? 'BLOCKED' : 'RECOMMENDED_NOT_EXECUTED',
          metadata: { source: 'SYSTEM', provider: 'DEMO_SEED', amount: row.amount, currency: 'INR' }
        });
      }
    }

    console.log('\n## RecoverAI Demo Seed');
    console.log(`Scenarios processed: ${processed}`);
    console.log(`Created: ${created}`);
    console.log(`Reconciled: ${reconciled}`);
    console.log(`Preserved recoveries: ${preservedRecoveries}`);
    console.log(`Skipped existing: 0`);
    console.log('');
    console.log(`Seed-created recovered revenue: ₹${seedCreatedRecoveredRevenue}`);
    console.log(`Existing recovered revenue preserved: ₹${existingRecoveredRevenuePreserved}`);
    console.log('');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error('Demo seed failed:', error.message); process.exitCode = 1; });
}

function isGenuinelyRecoveredDemoCase(recoveryCase, recoveryActions, auditEvents) {
  const evidenceCases = new Set(
    auditEvents
      .filter((event) => event.type === 'RECOVERY_COMPLETED' && event.actor === 'RAZORPAY')
      .map((event) => String(event.recoveryCase))
  );
  return hasRecoveryEvidence(recoveryCase, recoveryActions, evidenceCases);
}

module.exports = { DEMO_POLICY_CONFIG, DEMO_SCENARIOS, isGenuinelyRecoveredDemoCase, main };

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
