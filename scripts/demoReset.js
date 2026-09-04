const mongoose = require('mongoose');
const assert = require('node:assert/strict');
const { connectDatabase } = require('../src/config/database');
const Merchant = require('../src/models/Merchant');
const Customer = require('../src/models/Customer');
const Payment = require('../src/models/Payment');
const RecoveryCase = require('../src/models/RecoveryCase');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const { RecoveryPolicy } = require('../src/models/RecoveryPolicy');
const { evaluateRecoveryAction } = require('../src/services/policyEngine');
const { RECOVERY_ACTION_TYPE, RECOVERY_CASE_STATUS, PAYMENT_STATUS, AUDIT_EVENT_TYPE } = require('../src/constants/enums');

const TARGET_PAYMENT_IDS = ['demo_temporary_01', 'demo_temporary_02'];
const TARGET_ACTION_KEYS = TARGET_PAYMENT_IDS.map((id) => `demo:${id.replace('demo_', '')}`);
const NEW_PAYMENT_IDS = ['demo_fresh_a', 'demo_fresh_b'];
const NEW_ACTION_KEYS = NEW_PAYMENT_IDS.map((id) => `demo:${id.replace('demo_', '')}`);

const DEMO_SCENARIOS = [
  { id: 'fresh_a', amount: 120000, code: 'insufficient_funds', retryCount: 2, contactCount: 0, historicalStatus: null },
  { id: 'fresh_b', amount: 250000, code: 'insufficient_funds', retryCount: 1, contactCount: 0, historicalStatus: null }
];

async function purgeTargetCases() {
  console.log('\n=== PURGING TARGET DEMO CASES ===\n');

  const targetPayments = await Payment.find({ razorpayPaymentId: { $in: TARGET_PAYMENT_IDS } }).lean();
  console.log(`Found ${targetPayments.length} target payments`);
  targetPayments.forEach((p) => console.log(`  Payment: ${p._id} (${p.razorpayPaymentId})`));

  const targetCases = await RecoveryCase.find({ payment: { $in: targetPayments.map((p) => p._id) } }).lean();
  console.log(`Found ${targetCases.length} target recovery cases`);
  targetCases.forEach((c) => console.log(`  Case: ${c._id} (payment: ${c.payment})`));

  const targetActions = await RecoveryAction.find({ recoveryCase: { $in: targetCases.map((c) => c._id) } }).lean();
  console.log(`Found ${targetActions.length} target recovery actions`);
  targetActions.forEach((a) => console.log(`  Action: ${a._id} (key: ${a.idempotencyKey})`));

  const targetAudits = await AuditEvent.find({
    $or: [
      { recoveryCase: { $in: targetCases.map((c) => c._id) } },
      { payment: { $in: targetPayments.map((p) => p._id) } },
      { recoveryAction: { $in: targetActions.map((a) => a._id) } }
    ]
  }).lean();
  console.log(`Found ${targetAudits.length} target audit events`);

  const deleteResultActions = await RecoveryAction.deleteMany({ _id: { $in: targetActions.map((a) => a._id) } });
  console.log(`Deleted ${deleteResultActions.deletedCount} recovery actions`);

  const deleteResultAudits = await mongoose.connection.db.collection('auditevents').deleteMany({
    $or: [
      { recoveryCase: { $in: targetCases.map((c) => c._id) } },
      { payment: { $in: targetPayments.map((p) => p._id) } },
      { recoveryAction: { $in: targetActions.map((a) => a._id) } }
    ]
  });
  console.log(`Deleted ${deleteResultAudits.deletedCount} audit events`);

  const deleteResultCases = await RecoveryCase.deleteMany({ _id: { $in: targetCases.map((c) => c._id) } });
  console.log(`Deleted ${deleteResultCases.deletedCount} recovery cases`);

  const deleteResultPayments = await Payment.deleteMany({ _id: { $in: targetPayments.map((p) => p._id) } });
  console.log(`Deleted ${deleteResultPayments.deletedCount} payments`);

  return { targetPayments, targetCases, targetActions, targetAudits };
}

async function createFreshCases() {
  console.log('\n=== CREATING FRESH DEMO CASES ===\n');

  const merchant = await Merchant.findOne({ slug: 'recoverai-demo' }).lean();
  if (!merchant) {
    throw new Error('Demo merchant not found. Run seedDemoData first.');
  }
  const merchantId = merchant._id;
  console.log(`Demo merchant: ${merchantId} (${merchant.name})`);

  let policy = await RecoveryPolicy.findOne({ merchant: merchantId }).lean();
  if (!policy) {
    policy = await RecoveryPolicy.create({ merchant: merchantId, ...require('./seedDemoData').DEMO_POLICY_CONFIG });
    console.log(`Created demo policy: ${policy._id}`);
  } else {
    console.log(`Existing demo policy: ${policy._id}`);
  }

  let customer = await Customer.findOne({ merchant: merchantId, externalCustomerId: 'demo_customer' }).lean();
  if (!customer) {
    customer = await Customer.create({
      merchant: merchantId,
      externalCustomerId: 'demo_customer',
      email: 'customer@demo.test',
      phone: '+919900000001'
    });
    console.log(`Created demo customer: ${customer._id}`);
  } else {
    console.log(`Existing demo customer: ${customer._id}`);
  }

  for (const row of DEMO_SCENARIOS) {
    const existingPayment = await Payment.findOne({ merchant: merchantId, razorpayPaymentId: `demo_${row.id}` }).lean();
    if (existingPayment) {
      const existingCase = await RecoveryCase.findOne({ merchant: merchantId, payment: existingPayment._id }).lean();
      if (existingCase) {
        await RecoveryAction.deleteMany({ recoveryCase: existingCase._id });
        await RecoveryCase.deleteMany({ _id: existingCase._id });
        await Payment.deleteMany({ _id: existingPayment._id });
        console.log(`Cleaned up existing case for ${row.id}`);
      }
    }
  }

  const createdCases = [];
  for (const row of DEMO_SCENARIOS) {
    console.log(`\nCreating case: ${row.id} (₹${row.amount / 100})`);

    const payment = await Payment.findOneAndUpdate(
      { merchant: merchantId, razorpayPaymentId: `demo_${row.id}` },
      {
        merchant: merchantId,
        customer: customer._id,
        razorpayPaymentId: `demo_${row.id}`,
        amount: row.amount,
        currency: 'INR',
        status: 'FAILED',
        failure: { code: row.code, description: `Development demo ${row.code}` },
        attemptCount: 1
      },
      { upsert: true, new: true }
    );
    console.log(`  Payment: ${payment._id} (${payment.razorpayPaymentId})`);

    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { merchant: merchantId, payment: payment._id },
      {
        merchant: merchantId,
        payment: payment._id,
        status: 'DETECTED',
        retryCount: row.retryCount || 0,
        customerContactAttempts: row.contactCount || 0,
        recoveredAmount: 0
      },
      { upsert: true, new: true }
    );
    console.log(`  Case: ${recoveryCase._id} (${recoveryCase.status})`);

    const actionType = 'CUSTOMER_REMINDER';
    const policyResult = evaluateRecoveryAction({
      policy,
      payment,
      recoveryCase,
      customer,
      recommendation: { type: actionType, confidence: 0.9 }
    });

    const baseStatus = policyResult.allowed ? 'POLICY_ALLOWED' : 'POLICY_BLOCKED';
    const actionStatus = row.historicalStatus || baseStatus;

    const action = await RecoveryAction.findOneAndUpdate(
      { idempotencyKey: `demo:${row.id}` },
      {
        merchant: merchantId,
        payment: payment._id,
        recoveryCase: recoveryCase._id,
        type: actionType,
        status: actionStatus,
        recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: `Development demo ${row.code}` },
        policyDecision: { decision: policyResult.allowed ? 'ALLOWED' : 'BLOCKED', reason: policyResult.reason || 'Policy evaluation passed.' },
        idempotencyKey: `demo:${row.id}`
      },
      { upsert: true, new: true }
    );
    console.log(`  Action: ${action._id} (${action.status}, ${action.policyDecision.decision})`);
    console.log(`  Policy evaluation: ${policyResult.reason}`);

    await AuditEvent.create({
      merchant: merchantId,
      payment: payment._id,
      recoveryCase: recoveryCase._id,
      recoveryAction: action._id,
      providerEventId: `recoverai:case:${recoveryCase._id}:CREATED`,
      type: AUDIT_EVENT_TYPE.RECOVERY_CASE_CREATED,
      actor: 'SYSTEM',
      reason: 'Demo case created for live recovery workflow.',
      result: 'PENDING'
    });

    await AuditEvent.create({
      merchant: merchantId,
      payment: payment._id,
      recoveryCase: recoveryCase._id,
      recoveryAction: action._id,
      providerEventId: `recoverai:payment:${payment._id}:FAILED`,
      type: AUDIT_EVENT_TYPE.PAYMENT_FAILED,
      actor: 'RAZORPAY',
      reason: `Payment failed with code: ${row.code}`,
      result: 'FAILED',
      metadata: { provider: 'RAZORPAY', paymentId: payment.razorpayPaymentId, amount: payment.amount, currency: payment.currency }
    });

    createdCases.push({
      id: row.id,
      paymentId: payment._id,
      caseId: recoveryCase._id,
      actionId: action._id,
      amount: row.amount,
      code: row.code,
      status: actionStatus,
      policyDecision: policyResult.allowed ? 'ALLOWED' : 'BLOCKED'
    });
  }

  return createdCases;
}

async function verifyFinalState() {
  console.log('\n=== VERIFYING FINAL STATE ===\n');

  const merchant = await Merchant.findOne({ slug: 'recoverai-demo' }).lean();
  assert.ok(merchant, 'Demo merchant must exist');
  const merchantId = merchant._id;

  const totalCases = await RecoveryCase.countDocuments();
  console.log(`Total recovery cases in DB: ${totalCases}`);

  const demoTenantCases = await RecoveryCase.countDocuments({ merchant: merchantId });
  console.log(`Demo merchant cases: ${demoTenantCases}`);
  assert.equal(demoTenantCases, 21, 'Expected exactly 21 demo merchant recovery cases');

  for (const paymentId of TARGET_PAYMENT_IDS) {
    const payment = await Payment.findOne({ razorpayPaymentId: paymentId }).lean();
    console.log(`Payment ${paymentId}: ${payment ? 'EXISTS (BAD)' : 'absent (good)'}`);
    assert.equal(payment, null, `Payment ${paymentId} should not exist`);
  }

  const allDemoCases = await RecoveryCase.find({ merchant: merchantId }).lean();
  console.log(`\nDemo case payment IDs:`);
  for (const c of allDemoCases) {
    const payment = await Payment.findById(c.payment).lean();
    console.log(`  ${c._id} -> ${payment?.razorpayPaymentId || 'unknown'} (${c.status})`);
  }

  for (const actionKey of TARGET_ACTION_KEYS) {
    const action = await RecoveryAction.findOne({ idempotencyKey: actionKey }).lean();
    console.log(`Action ${actionKey}: ${action ? 'EXISTS (BAD)' : 'absent (good)'}`);
    assert.equal(action, null, `Action ${actionKey} should not exist`);
  }

  for (const actionKey of NEW_ACTION_KEYS) {
    const action = await RecoveryAction.findOne({ idempotencyKey: actionKey }).lean();
    console.log(`Action ${actionKey}: ${action ? `EXISTS (${action.status})` : 'MISSING (BAD)'}`);
    assert.ok(action, `Action ${actionKey} should exist`);
    assert.equal(action.status, 'POLICY_ALLOWED', `Action ${actionKey} should be POLICY_ALLOWED`);
  }

  console.log('\nVerification complete.');
}

async function main() {
  console.log('Starting demo database reset...\n');

  await connectDatabase();
  console.log('Connected to MongoDB');
  console.log(`Database: ${mongoose.connection.db.databaseName}`);

  if (mongoose.connection.db.databaseName === 'recoverai') {
    console.warn('\nWARNING: Connected to production/demo database "recoverai"');
  }

  for (const id of NEW_PAYMENT_IDS) {
    const existingPayment = await Payment.findOne({ razorpayPaymentId: id }).lean();
    if (existingPayment) {
      const existingCase = await RecoveryCase.findOne({ payment: existingPayment._id }).lean();
      if (existingCase) {
        await RecoveryAction.deleteMany({ recoveryCase: existingCase._id });
        await mongoose.connection.db.collection('auditevents').deleteMany({ recoveryCase: existingCase._id });
        await RecoveryCase.deleteMany({ _id: existingCase._id });
        await Payment.deleteMany({ _id: existingPayment._id });
        console.log(`Cleaned up existing fresh case: ${id}`);
      }
    }
  }

  const purgeStats = await purgeTargetCases();
  const newCases = await createFreshCases();
  await verifyFinalState();

  console.log('\n=== SUMMARY ===');
  console.log('Deleted cases:', TARGET_PAYMENT_IDS.join(', '));
  console.log('Deleted payments:', purgeStats.targetPayments.length);
  console.log('Deleted cases:', purgeStats.targetCases.length);
  console.log('Deleted actions:', purgeStats.targetActions.length);
  console.log('Deleted audits:', purgeStats.targetAudits.length);
  console.log('\nCreated cases:');
  for (const c of newCases) {
    console.log(`  ${c.id}: ${c.caseId} | ₹${c.amount / 100} | ${c.code} | ${c.status} | ${c.policyDecision}`);
  }
  console.log('\nTotal cases after reset:', await RecoveryCase.countDocuments());
  console.log('\nDemo reset complete.');

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Demo reset failed:', error);
  process.exit(1);
});
