const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectDatabase, assertTestDatabase } = require('../src/config/database');
const Merchant = require('../src/models/Merchant');
const MerchantUser = require('../src/models/MerchantUser');
const Payment = require('../src/models/Payment');
const RecoveryCase = require('../src/models/RecoveryCase');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const { RecoveryPolicy } = require('../src/models/RecoveryPolicy');
const Customer = require('../src/models/Customer');

async function ensureDemoMerchant() {
  process.env.DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'test-demo-password';
  let merchant = await Merchant.findOne({ slug: 'recoverai-demo' }).lean();
  if (!merchant) {
    const { main: seedMain } = require('../scripts/seedDemoData');
    await seedMain();
    await connectDatabase();
    merchant = await Merchant.findOne({ slug: 'recoverai-demo' }).lean();
  }
  return merchant;
}

async function cleanupMerchantData(merchantId) {
  await Payment.deleteMany({ merchant: merchantId });
  await RecoveryCase.deleteMany({ merchant: merchantId });
  await RecoveryAction.deleteMany({ merchant: merchantId });
  await AuditEvent.deleteMany({ merchant: merchantId });
  await RecoveryPolicy.deleteMany({ merchant: merchantId });
  await MerchantUser.deleteMany({ merchant: merchantId });
  await Customer.deleteMany({ merchant: merchantId });
  await Merchant.deleteMany({ _id: merchantId });
}

test('Test A: test environment selects test database name', () => {
  const { env } = require('../src/config/env');
  if (env.nodeEnv !== 'test') {
    console.warn('Skipping Test A: NODE_ENV is not "test"');
    return;
  }
  assert.ok(env.testMongoUri.endsWith('/recoverai_test') || env.testMongoUri.endsWith('/recoverai_test?'));
  assert.notEqual(env.testMongoUri, env.mongoUri);
});

test('Test B: destructive cleanup refuses demo database', async () => {
  const { env } = require('../src/config/env');
  if (env.nodeEnv !== 'test') {
    console.warn('Skipping Test B: NODE_ENV is not "test"');
    return;
  }
  await connectDatabase();
  try {
    assertTestDatabase();

    const originalConnection = mongoose.connection;
    const fakeConnection = { db: { databaseName: 'recoverai' } };
    
    Object.defineProperty(mongoose, 'connection', {
      get: () => fakeConnection,
      configurable: true
    });
    
    assert.rejects(async () => assertTestDatabase(), /Refusing destructive cleanup against non-test database/);
    
    Object.defineProperty(mongoose, 'connection', {
      get: () => originalConnection,
      configurable: true
    });
  } finally {
    await mongoose.disconnect();
  }
});

test('Test C: test cleanup works against test database', async () => {
  const { env } = require('../src/config/env');
  if (env.nodeEnv !== 'test') {
    console.warn('Skipping Test C: NODE_ENV is not "test"');
    return;
  }
  await connectDatabase();
  try {
    assertTestDatabase();
    await Merchant.deleteMany({});
    await MerchantUser.deleteMany({});
    await mongoose.connection.db.collection('payments').deleteMany({});
    await mongoose.connection.db.collection('recoverycases').deleteMany({});
    await mongoose.connection.db.collection('recoveryactions').deleteMany({});
    await mongoose.connection.db.collection('auditevents').deleteMany({});
    await mongoose.connection.db.collection('recoverypolicies').deleteMany({});
  } finally {
    await mongoose.disconnect();
  }
});

test('Test D: test suite cannot delete demo data via cleanup guard', async () => {
  const { env } = require('../src/config/env');
  if (env.nodeEnv !== 'test') {
    console.warn('Skipping Test D: NODE_ENV is not "test"');
    return;
  }
  await connectDatabase();
  try {
    assertTestDatabase();

    const sentinelMerchant = await Merchant.create({ slug: 'database-safety-sentinel', name: 'Database Safety Sentinel', status: 'ACTIVE' });
    const sentinelUser = await MerchantUser.create({ merchant: sentinelMerchant._id, email: 'sentinel@database-safety.test', passwordHash: 'test', role: 'MERCHANT_ADMIN', status: 'ACTIVE' });

    const sentinelPayment = await Payment.create({ merchant: sentinelMerchant._id, customer: sentinelMerchant._id, razorpayPaymentId: 'sentinel_payment', amount: 1000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
    const sentinelCase = await RecoveryCase.create({ merchant: sentinelMerchant._id, payment: sentinelPayment._id, status: 'DETECTED', recoveredAmount: 0 });
    const sentinelAction = await RecoveryAction.create({ merchant: sentinelMerchant._id, payment: sentinelPayment._id, recoveryCase: sentinelCase._id, type: 'CUSTOMER_REMINDER', status: 'POLICY_ALLOWED', recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test' }, idempotencyKey: 'sentinel:1' });
    await AuditEvent.create({ merchant: sentinelMerchant._id, payment: sentinelPayment._id, recoveryCase: sentinelCase._id, recoveryAction: sentinelAction._id, type: 'PAYMENT_FAILED', actor: 'SYSTEM', providerEventId: 'sentinel:1:PAYMENT_FAILED' });

    const beforeMerchant = await Merchant.countDocuments({ _id: sentinelMerchant._id });
    const beforeUser = await MerchantUser.countDocuments({ _id: sentinelUser._id });
    const beforePayment = await Payment.countDocuments({ _id: sentinelPayment._id });
    const beforeCase = await RecoveryCase.countDocuments({ _id: sentinelCase._id });
    const beforeAction = await RecoveryAction.countDocuments({ _id: sentinelAction._id });
    const beforeAudit = await AuditEvent.countDocuments({ merchant: sentinelMerchant._id });

    assert.equal(beforeMerchant, 1);
    assert.equal(beforeUser, 1);
    assert.equal(beforePayment, 1);
    assert.equal(beforeCase, 1);
    assert.equal(beforeAction, 1);
    assert.ok(beforeAudit > 0);

    await Merchant.deleteMany({ _id: sentinelMerchant._id });
    await MerchantUser.deleteMany({ _id: sentinelUser._id });
    await Payment.deleteMany({ _id: sentinelPayment._id });
    await RecoveryCase.deleteMany({ _id: sentinelCase._id });
    await RecoveryAction.deleteMany({ _id: sentinelAction._id });
    await AuditEvent.deleteMany({ merchant: sentinelMerchant._id });

    const afterMerchant = await Merchant.countDocuments({ _id: sentinelMerchant._id });
    const afterUser = await MerchantUser.countDocuments({ _id: sentinelUser._id });
    const afterPayment = await Payment.countDocuments({ _id: sentinelPayment._id });
    const afterCase = await RecoveryCase.countDocuments({ _id: sentinelCase._id });
    const afterAction = await RecoveryAction.countDocuments({ _id: sentinelAction._id });
    const afterAudit = await AuditEvent.countDocuments({ merchant: sentinelMerchant._id });

    assert.equal(afterMerchant, 0);
    assert.equal(afterUser, 0);
    assert.equal(afterPayment, 0);
    assert.equal(afterCase, 0);
    assert.equal(afterAction, 0);
    assert.equal(afterAudit, 0);
  } finally {
    await mongoose.disconnect();
  }
});

test('Test E: demo merchant uniqueness across repeated seed execution', async () => {
  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await ensureDemoMerchant();
    merchantId = String(merchant._id);

    const initialCount = await Merchant.countDocuments({ slug: 'recoverai-demo' });
    assert.equal(initialCount, 1, 'Exactly one demo merchant must exist');

    const { main: seedMain } = require('../scripts/seedDemoData');
    await seedMain();
    await connectDatabase();

    const afterCount = await Merchant.countDocuments({ slug: 'recoverai-demo' });
    assert.equal(afterCount, 1, 'Seed must not create duplicate demo merchants');
  } finally {
    if (merchantId) await cleanupMerchantData(merchantId);
    await mongoose.disconnect();
  }
});

test('Test F: demo login merchant stability across repeated seeds', async () => {
  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await ensureDemoMerchant();
    merchantId = String(merchant._id);

    const { main: seedMain } = require('../scripts/seedDemoData');
    await seedMain();
    await connectDatabase();

    const user = await MerchantUser.findOne({ email: 'demo@recoverai.test' }).lean();
    assert.ok(user, 'Demo user must exist');
    assert.equal(String(user.merchant), merchantId, 'Demo user must always point to the deterministic demo merchant');

    await seedMain();
    await connectDatabase();

    const userAfter = await MerchantUser.findOne({ email: 'demo@recoverai.test' }).lean();
    assert.ok(userAfter);
    assert.equal(String(userAfter.merchant), merchantId, 'Demo user merchant pointer must remain stable after repeated seeding');
  } finally {
    if (merchantId) await cleanupMerchantData(merchantId);
    await mongoose.disconnect();
  }
});

test('Test G: genuine recovery preservation across seeding', async () => {
  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await ensureDemoMerchant();
    merchantId = String(merchant._id);

    const customer = await Customer.findOne({ merchant: merchantId, externalCustomerId: 'demo_customer' });
    const payment = await Payment.findOneAndUpdate(
      { merchant: merchantId, razorpayPaymentId: 'demo_genuine_recovery_g' },
      { merchant: merchantId, customer: customer._id, razorpayPaymentId: 'demo_genuine_recovery_g', amount: 500000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { upsert: true, new: true }
    );
    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { payment: payment._id },
      { merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 500000, resolvedAt: new Date() },
      { upsert: true, new: true }
    );
    const action = await RecoveryAction.findOneAndUpdate(
      { idempotencyKey: 'demo:genuine_recovery_g' },
      { merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_genuine_g', result: 'PAYMENT_CONFIRMED', providerPaymentId: 'pay_genuine_g' }, recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test', evaluatedAt: new Date() }, idempotencyKey: 'demo:genuine_recovery_g' },
      { upsert: true, new: true }
    );
    await AuditEvent.create({
      merchant: merchantId,
      payment: payment._id,
      recoveryCase: recoveryCase._id,
      recoveryAction: action._id,
      providerEventId: 'demo:genuine_recovery_g:RECOVERY_COMPLETED',
      type: 'RECOVERY_COMPLETED',
      actor: 'RAZORPAY',
      reason: 'Genuine recovery for test.',
      result: 'PAYMENT_CONFIRMED',
      metadata: { provider: 'RAZORPAY', providerPaymentId: 'pay_genuine_g', providerLinkId: 'plink_genuine_g', amount: 500000, currency: 'INR' }
    });

    const { main: seedMain } = require('../scripts/seedDemoData');
    await seedMain();
    await connectDatabase();

    const updatedCase = await RecoveryCase.findOne({ merchant: merchantId, payment: payment._id }).lean();
    assert.equal(updatedCase.status, 'RECOVERED');
    assert.equal(updatedCase.recoveredAmount, 500000);

    const updatedAction = await RecoveryAction.findOne({ merchant: merchantId, idempotencyKey: 'demo:genuine_recovery_g' }).lean();
    assert.equal(updatedAction.status, 'EXECUTED');
    assert.equal(updatedAction.execution.result, 'PAYMENT_CONFIRMED');

    const recoveryEvent = await AuditEvent.findOne({ merchant: merchantId, providerEventId: 'demo:genuine_recovery_g:RECOVERY_COMPLETED' }).lean();
    assert.ok(recoveryEvent);
    assert.equal(recoveryEvent.actor, 'RAZORPAY');
  } finally {
    if (merchantId) await cleanupMerchantData(merchantId);
    await mongoose.disconnect();
  }
});

test('Test H: duplicate display name does not confuse demo merchant resolution', async () => {
  await connectDatabase();
  let merchantId = null;
  let otherMerchantId = null;
  try {
    process.env.DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'test-demo-password';
    const sluggedMerchant = await Merchant.create({ slug: 'recoverai-demo', name: 'RecoverAI Demo Merchant', status: 'ACTIVE' });
    const otherMerchant = await Merchant.create({ name: 'RecoverAI Demo Merchant', status: 'ACTIVE' });
    merchantId = String(sluggedMerchant._id);
    otherMerchantId = String(otherMerchant._id);

    const hash = await new (require('../src/services/authService').AuthService)().hashPassword('test-demo-password');
    await MerchantUser.create({ merchant: sluggedMerchant._id, email: 'demo@recoverai.test', passwordHash: hash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' });

    const { main: seedMain } = require('../scripts/seedDemoData');
    await seedMain();
    await connectDatabase();

    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' }).lean();
    assert.ok(merchant);
    assert.equal(String(merchant._id), merchantId, 'Seed must select the deterministic slugged merchant');

    const user = await MerchantUser.findOne({ email: 'demo@recoverai.test' }).lean();
    assert.ok(user);
    assert.equal(String(user.merchant), merchantId, 'Demo user must point to the deterministic slugged merchant');

    const otherMerchantAfter = await Merchant.findOne({ _id: otherMerchantId }).lean();
    assert.ok(otherMerchantAfter);
    assert.notEqual(String(otherMerchantAfter._id), merchantId);
  } finally {
    await connectDatabase();
    if (merchantId) await cleanupMerchantData(merchantId);
    if (otherMerchantId) {
      await Payment.deleteMany({ merchant: otherMerchantId });
      await RecoveryCase.deleteMany({ merchant: otherMerchantId });
      await RecoveryAction.deleteMany({ merchant: otherMerchantId });
      await AuditEvent.deleteMany({ merchant: otherMerchantId });
      await RecoveryPolicy.deleteMany({ merchant: otherMerchantId });
      await MerchantUser.deleteMany({ merchant: otherMerchantId });
      await Merchant.deleteMany({ _id: otherMerchantId });
    }
    await mongoose.disconnect();
  }
});

test('Test I: cross-merchant isolation — demo seed does not touch another merchant data', async () => {
  await connectDatabase();
  let demoMerchantId = null;
  let otherMerchantId = null;
  try {
    process.env.DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'test-demo-password';
    const demoMerchant = await Merchant.create({ slug: 'recoverai-demo', name: 'RecoverAI Demo Merchant', status: 'ACTIVE' });
    const otherMerchant = await Merchant.create({ name: 'Other Merchant', status: 'ACTIVE' });
    demoMerchantId = String(demoMerchant._id);
    otherMerchantId = String(otherMerchant._id);

    const hash = await new (require('../src/services/authService').AuthService)().hashPassword('test-demo-password');
    await MerchantUser.create({ merchant: demoMerchant._id, email: 'demo@recoverai.test', passwordHash: hash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' });

    const otherCustomer = await Customer.create({ merchant: otherMerchant._id, externalCustomerId: 'other_customer', email: 'other@test.com', phone: '+919900000002' });
    const otherPayment = await Payment.create({
      merchant: otherMerchant._id,
      customer: otherCustomer._id,
      razorpayPaymentId: 'other_temporary_01',
      amount: 999999,
      currency: 'INR',
      status: 'CAPTURED',
      failure: { code: 'none', description: 'Other merchant payment' },
      attemptCount: 1
    });
    const otherCase = await RecoveryCase.create({
      merchant: otherMerchant._id,
      payment: otherPayment._id,
      status: 'RECOVERED',
      recoveredAmount: 999999,
      resolvedAt: new Date()
    });
    const otherAction = await RecoveryAction.create({
      merchant: otherMerchant._id,
      payment: otherPayment._id,
      recoveryCase: otherCase._id,
      type: 'CUSTOMER_REMINDER',
      status: 'EXECUTED',
      execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_other', result: 'PAYMENT_CONFIRMED', providerPaymentId: 'pay_other' },
      recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Other' },
      policyDecision: { decision: 'ALLOWED', reason: 'Other' },
      idempotencyKey: 'other:1'
    });
    await AuditEvent.create({
      merchant: otherMerchant._id,
      payment: otherPayment._id,
      recoveryCase: otherCase._id,
      recoveryAction: otherAction._id,
      providerEventId: 'other:1:RECOVERY_COMPLETED',
      type: 'RECOVERY_COMPLETED',
      actor: 'RAZORPAY',
      reason: 'Other recovery.',
      result: 'PAYMENT_CONFIRMED',
      metadata: { provider: 'RAZORPAY', providerPaymentId: 'pay_other', providerLinkId: 'plink_other', amount: 999999, currency: 'INR' }
    });

    const { main: seedMain } = require('../scripts/seedDemoData');
    await seedMain();
    await connectDatabase();

    const untouchedPayment = await Payment.findOne({ merchant: otherMerchant._id, razorpayPaymentId: 'other_temporary_01' }).lean();
    assert.ok(untouchedPayment, 'Other merchant payment must still exist');
    assert.equal(untouchedPayment.status, 'CAPTURED', 'Other merchant payment status must be unchanged');
    assert.equal(untouchedPayment.amount, 999999, 'Other merchant payment amount must be unchanged');

    const untouchedCase = await RecoveryCase.findOne({ merchant: otherMerchant._id, payment: otherPayment._id }).lean();
    assert.ok(untouchedCase);
    assert.equal(untouchedCase.status, 'RECOVERED', 'Other merchant recovery case must remain RECOVERED');
    assert.equal(untouchedCase.recoveredAmount, 999999, 'Other merchant recovered amount must be unchanged');

    const untouchedAction = await RecoveryAction.findOne({ merchant: otherMerchant._id, idempotencyKey: 'other:1' }).lean();
    assert.ok(untouchedAction);
    assert.equal(untouchedAction.status, 'EXECUTED');
    assert.equal(untouchedAction.execution.result, 'PAYMENT_CONFIRMED');
    assert.equal(untouchedAction.execution.providerReference, 'plink_other');

    const untouchedAudit = await AuditEvent.findOne({ merchant: otherMerchant._id, providerEventId: 'other:1:RECOVERY_COMPLETED' }).lean();
    assert.ok(untouchedAudit);
    assert.equal(untouchedAudit.actor, 'RAZORPAY');

    const demoPayment = await Payment.findOne({ merchant: demoMerchantId, razorpayPaymentId: 'demo_temporary_01' }).lean();
    assert.ok(demoPayment, 'Demo merchant must have its own scoped payment');
    assert.equal(demoPayment.status, 'FAILED', 'Demo payment must be the seeded FAILED state');
    assert.equal(demoPayment.amount, 499900, 'Demo payment must have the correct seeded amount');
  } finally {
    await connectDatabase();
    if (demoMerchantId) await cleanupMerchantData(demoMerchantId);
    if (otherMerchantId) {
      await Payment.deleteMany({ merchant: otherMerchantId });
      await RecoveryCase.deleteMany({ merchant: otherMerchantId });
      await RecoveryAction.deleteMany({ merchant: otherMerchantId });
      await AuditEvent.deleteMany({ merchant: otherMerchantId });
      await RecoveryPolicy.deleteMany({ merchant: otherMerchantId });
      await MerchantUser.deleteMany({ merchant: otherMerchantId });
      await Merchant.deleteMany({ _id: otherMerchantId });
    }
    await mongoose.disconnect();
  }
});

test('Test J: triple seed persistence — genuine recovery survives three consecutive seed runs', async () => {
  await connectDatabase();
  let merchantId = null;
  try {
    process.env.DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'test-demo-password';
    const merchant = await ensureDemoMerchant();
    merchantId = String(merchant._id);

    const customer = await Customer.findOne({ merchant: merchantId, externalCustomerId: 'demo_customer' });
    const payment = await Payment.findOneAndUpdate(
      { merchant: merchantId, razorpayPaymentId: 'demo_genuine_recovery_j' },
      { merchant: merchantId, customer: customer._id, razorpayPaymentId: 'demo_genuine_recovery_j', amount: 500000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { upsert: true, new: true }
    );
    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { merchant: merchantId, payment: payment._id },
      { merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 500000, resolvedAt: new Date() },
      { upsert: true, new: true }
    );
    const action = await RecoveryAction.findOneAndUpdate(
      { idempotencyKey: 'demo:genuine_recovery_j' },
      { merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_genuine_j', result: 'PAYMENT_CONFIRMED', providerPaymentId: 'pay_genuine_j' }, recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test', evaluatedAt: new Date() }, idempotencyKey: 'demo:genuine_recovery_j' },
      { upsert: true, new: true }
    );
    await AuditEvent.create({
      merchant: merchantId,
      payment: payment._id,
      recoveryCase: recoveryCase._id,
      recoveryAction: action._id,
      providerEventId: 'demo:genuine_recovery_j:RECOVERY_COMPLETED',
      type: 'RECOVERY_COMPLETED',
      actor: 'RAZORPAY',
      reason: 'Genuine recovery for triple-seed test.',
      result: 'PAYMENT_CONFIRMED',
      metadata: { provider: 'RAZORPAY', providerPaymentId: 'pay_genuine_j', providerLinkId: 'plink_genuine_j', amount: 500000, currency: 'INR' }
    });

    const baseline = {
      caseStatus: 'RECOVERED',
      recoveredAmount: 500000,
      actionStatus: 'EXECUTED',
      actionResult: 'PAYMENT_CONFIRMED',
      providerReference: 'plink_genuine_j',
      providerPaymentId: 'pay_genuine_j',
      auditActor: 'RAZORPAY',
      auditEventId: 'demo:genuine_recovery_j:RECOVERY_COMPLETED'
    };

    const { main: seedMain } = require('../scripts/seedDemoData');

    for (let run = 1; run <= 3; run++) {
      await seedMain();
      await connectDatabase();

      const updatedCase = await RecoveryCase.findOne({ merchant: merchantId, payment: payment._id }).lean();
      assert.equal(updatedCase.status, baseline.caseStatus, `Run ${run}: case status must remain RECOVERED`);
      assert.equal(updatedCase.recoveredAmount, baseline.recoveredAmount, `Run ${run}: recoveredAmount must be unchanged`);

      const updatedAction = await RecoveryAction.findOne({ merchant: merchantId, idempotencyKey: 'demo:genuine_recovery_j' }).lean();
      assert.equal(updatedAction.status, baseline.actionStatus, `Run ${run}: action status must remain EXECUTED`);
      assert.equal(updatedAction.execution.result, baseline.actionResult, `Run ${run}: action result must remain PAYMENT_CONFIRMED`);
      assert.equal(updatedAction.execution.providerReference, baseline.providerReference, `Run ${run}: providerReference must be unchanged`);
      assert.equal(updatedAction.execution.providerPaymentId, baseline.providerPaymentId, `Run ${run}: providerPaymentId must be unchanged`);

      const recoveryEvent = await AuditEvent.findOne({ merchant: merchantId, providerEventId: baseline.auditEventId }).lean();
      assert.ok(recoveryEvent, `Run ${run}: RECOVERY_COMPLETED audit event must still exist`);
      assert.equal(recoveryEvent.actor, baseline.auditActor, `Run ${run}: audit actor must remain RAZORPAY`);

      const duplicateCases = await RecoveryCase.find({ merchant: merchantId, payment: payment._id }).lean();
      assert.equal(duplicateCases.length, 1, `Run ${run}: must not create duplicate recovery cases`);

      const duplicatePayments = await Payment.find({ merchant: merchantId, razorpayPaymentId: 'demo_genuine_recovery_j' }).lean();
      assert.equal(duplicatePayments.length, 1, `Run ${run}: must not create duplicate payments`);

      const duplicateActions = await RecoveryAction.find({ merchant: merchantId, idempotencyKey: 'demo:genuine_recovery_j' }).lean();
      assert.equal(duplicateActions.length, 1, `Run ${run}: must not create duplicate recovery actions`);
    }
  } finally {
    await connectDatabase();
    if (merchantId) await cleanupMerchantData(merchantId);
    await mongoose.disconnect();
  }
});
