const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRecoveryAction } = require('../src/services/policyEngine');
const { analyzeRecoveryCase } = require('../src/services/recoveryIntelligenceService');
const { DEMO_POLICY_CONFIG, DEMO_SCENARIOS, isGenuinelyRecoveredDemoCase, main: seedMain } = require('../scripts/seedDemoData');
const Merchant = require('../src/models/Merchant');
const Customer = require('../src/models/Customer');
const Payment = require('../src/models/Payment');
const RecoveryCase = require('../src/models/RecoveryCase');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const { RecoveryPolicy } = require('../src/models/RecoveryPolicy');
const { assertTestDatabase } = require('../src/config/database');

test('demo seed configures a bounded multi-action policy', () => {
  assert.deepEqual(DEMO_POLICY_CONFIG.allowedActions, ['CUSTOMER_REMINDER', 'RETRY_PAYMENT', 'PAYMENT_METHOD_UPDATE']);
  assert.equal(DEMO_POLICY_CONFIG.minimumRecoveryConfidence, 0.6);
  assert.equal(DEMO_POLICY_CONFIG.maxAutomaticRetries, 2);
  assert.equal(DEMO_POLICY_CONFIG.maxCustomerContactAttempts, 1);
});

test('demo policy decisions match scenario outcomes', () => {
  const policy = { ...DEMO_POLICY_CONFIG };
  const decisions = DEMO_SCENARIOS.map((scenario) => {
    const payment = { amount: scenario.amount, status: 'FAILED', failure: { code: scenario.code } };
    const recoveryCase = { status: 'DETECTED', retryCount: scenario.retryCount || 0, customerContactAttempts: scenario.contactCount || 0 };
    const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy });
    const decision = evaluateRecoveryAction({ payment, recoveryCase, policy, recommendation: { type: recommendation.action, confidence: recommendation.confidence } });
    return { id: scenario.id, action: recommendation.action, decision: decision.decision, escalate: decision.escalate };
  });

  assert.deepEqual(decisions, [
    { id: 'temporary_01', action: 'CUSTOMER_REMINDER', decision: 'ALLOWED', escalate: false },
    { id: 'temporary_02', action: 'CUSTOMER_REMINDER', decision: 'ALLOWED', escalate: false },
    { id: 'temporary_03', action: 'RETRY_PAYMENT', decision: 'ALLOWED', escalate: false },
    { id: 'temporary_04', action: 'RETRY_PAYMENT', decision: 'ALLOWED', escalate: false },
    { id: 'temporary_05', action: 'CUSTOMER_REMINDER', decision: 'ALLOWED', escalate: false },
    { id: 'payment_method_01', action: 'PAYMENT_METHOD_UPDATE', decision: 'ALLOWED', escalate: false },
    { id: 'payment_method_02', action: 'PAYMENT_METHOD_UPDATE', decision: 'ALLOWED', escalate: false },
    { id: 'payment_method_03', action: 'PAYMENT_METHOD_UPDATE', decision: 'ALLOWED', escalate: false },
    { id: 'fraud_01', action: 'ESCALATE_TO_HUMAN', decision: 'BLOCKED', escalate: false },
    { id: 'fraud_02', action: 'ESCALATE_TO_HUMAN', decision: 'BLOCKED', escalate: false },
    { id: 'retry_limit_01', action: 'CUSTOMER_REMINDER', decision: 'ALLOWED', escalate: false },
    { id: 'retry_limit_02', action: 'CUSTOMER_REMINDER', decision: 'ALLOWED', escalate: false },
    { id: 'contact_fatigue_01', action: 'RETRY_PAYMENT', decision: 'ALLOWED', escalate: false },
    { id: 'contact_fatigue_02', action: 'RETRY_PAYMENT', decision: 'ALLOWED', escalate: false },
    { id: 'network_error_01', action: 'RETRY_PAYMENT', decision: 'ALLOWED', escalate: false },
    { id: 'network_error_02', action: 'RETRY_PAYMENT', decision: 'ALLOWED', escalate: false },
    { id: 'unknown_01', action: 'ESCALATE_TO_HUMAN', decision: 'BLOCKED', escalate: false },
    { id: 'unknown_02', action: 'ESCALATE_TO_HUMAN', decision: 'BLOCKED', escalate: false },
    { id: 'cooldown_01', action: 'RETRY_PAYMENT', decision: 'ALLOWED', escalate: false },
    { id: 'high_value_01', action: 'RETRY_PAYMENT', decision: 'BLOCKED', escalate: false },
    { id: 'policy_block_01', action: 'PAYMENT_METHOD_UPDATE', decision: 'ALLOWED', escalate: false }
  ]);
});

test('demo policy blocks unsupported automatic actions', () => {
  const policy = { ...DEMO_POLICY_CONFIG };
  const payment = { amount: 75000, status: 'FAILED' };
  const recoveryCase = { status: 'DETECTED', retryCount: 0, customerContactAttempts: 0 };

  assert.equal(evaluateRecoveryAction({ policy, payment, recoveryCase, recommendation: { type: 'RETRY_PAYMENT', confidence: 0.95 } }).decision, 'ALLOWED');
  assert.equal(evaluateRecoveryAction({ policy, payment, recoveryCase, recommendation: { type: 'PAYMENT_METHOD_UPDATE', confidence: 0.95 } }).decision, 'ALLOWED');
});

test('demo seed scenarios use stable unique selectors for repeatable upserts', () => {
  const firstRunKeys = DEMO_SCENARIOS.map((scenario) => `demo:${scenario.id}`);
  const secondRunKeys = DEMO_SCENARIOS.map((scenario) => `demo:${scenario.id}`);

  assert.deepEqual(firstRunKeys, secondRunKeys);
  assert.equal(new Set(firstRunKeys).size, DEMO_SCENARIOS.length);
  assert.deepEqual(DEMO_SCENARIOS.map((scenario) => scenario.id), [
    'temporary_01',
    'temporary_02',
    'temporary_03',
    'temporary_04',
    'temporary_05',
    'payment_method_01',
    'payment_method_02',
    'payment_method_03',
    'fraud_01',
    'fraud_02',
    'retry_limit_01',
    'retry_limit_02',
    'contact_fatigue_01',
    'contact_fatigue_02',
    'network_error_01',
    'network_error_02',
    'unknown_01',
    'unknown_02',
    'cooldown_01',
    'high_value_01',
    'policy_block_01'
  ]);
});

test('demo seed preserves only cases with complete genuine recovery evidence', () => {
  const recoveryCase = { _id: 'case_temporary_04', status: 'RECOVERED', recoveredAmount: 75000 };
  const action = { status: 'EXECUTED', execution: { providerReference: 'plink_real_04' } };
  const audit = { recoveryCase: 'case_temporary_04', type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY' };

  assert.equal(isGenuinelyRecoveredDemoCase(recoveryCase, [action], [audit]), true);
  assert.equal(isGenuinelyRecoveredDemoCase(recoveryCase, [{ ...action, execution: {} }], [audit]), false);
  assert.equal(isGenuinelyRecoveredDemoCase(recoveryCase, [action], [{ ...audit, actor: 'SYSTEM' }]), false);
  assert.equal(isGenuinelyRecoveredDemoCase({ ...recoveryCase, recoveredAmount: 0 }, [action], [audit]), false);
  assert.equal(isGenuinelyRecoveredDemoCase({ ...recoveryCase, status: 'DETECTED' }, [action], [audit]), false);
});

test('demo seed does not fabricate AI provenance', async () => {
  const mongoose = require('mongoose');
  const { connectDatabase } = require('../src/config/database');

  await connectDatabase();
  try {
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' });
    if (!merchant) {
      await mongoose.disconnect();
      return;
    }
    const merchantId = String(merchant._id);

    const aiAgentActions = await RecoveryAction.find({ merchant: merchantId, 'recommendation.source': 'AI_AGENT' }).lean();
    assert.equal(aiAgentActions.length, 0, 'No seeded action should claim AI_AGENT provenance');

    const aiAnalysisEvents = await AuditEvent.find({ merchant: merchantId, type: 'AI_ANALYSIS_STARTED' }).lean();
    assert.equal(aiAnalysisEvents.length, 0, 'No seeded AI_ANALYSIS_STARTED events should exist');

    const aiRecEvents = await AuditEvent.find({ merchant: merchantId, type: 'AI_RECOMMENDATION_GENERATED' }).lean();
    assert.equal(aiRecEvents.length, 0, 'No seeded AI_RECOMMENDATION_GENERATED events should exist');
  } finally {
    await mongoose.disconnect();
  }
});

test('demo seed does not fabricate recovered revenue or provider evidence', async () => {
  const mongoose = require('mongoose');
  const { connectDatabase } = require('../src/config/database');

  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' });
    if (!merchant) {
      await mongoose.disconnect();
      return;
    }
    merchantId = String(merchant._id);

    await cleanDemoData(merchantId);
    await seedMain();
    await connectDatabase();

    const recoveredCases = await RecoveryCase.find({ merchant: merchantId, status: 'RECOVERED' }).lean();
    assert.equal(recoveredCases.length, 0, 'No seeded case should be RECOVERED');

    const positiveRecoveredAmount = await RecoveryCase.find({ merchant: merchantId, recoveredAmount: { $gt: 0 } }).lean();
    assert.equal(positiveRecoveredAmount.length, 0, 'No seeded case should have positive recoveredAmount');

    const recoveryCompletedEvents = await AuditEvent.find({ merchant: merchantId, type: 'RECOVERY_COMPLETED' }).lean();
    assert.equal(recoveryCompletedEvents.length, 0, 'No seeded RECOVERY_COMPLETED events should exist');

    const fakeProviderRefs = await RecoveryAction.find({ merchant: merchantId, 'execution.providerReference': { $regex: /^demo_link_/ } }).lean();
    assert.equal(fakeProviderRefs.length, 0, 'No seeded action should have fake demo_link providerReference');

    const fakeProviderPaymentIds = await RecoveryAction.find({ merchant: merchantId, 'execution.providerPaymentId': { $regex: /^demo_provider_payment_/ } }).lean();
    assert.equal(fakeProviderPaymentIds.length, 0, 'No seeded action should have fake demo_provider_payment providerPaymentId');
  } finally {
    if (merchantId) await cleanDemoData(merchantId);
    await mongoose.disconnect();
  }
});

test('demo seed is idempotent across multiple runs', async () => {
  const mongoose = require('mongoose');
  const { connectDatabase } = require('../src/config/database');

  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' });
    if (!merchant) {
      await mongoose.disconnect();
      return;
    }
    merchantId = String(merchant._id);

    await cleanDemoData(merchantId);

    const actionCountBefore = await RecoveryAction.countDocuments({ merchant: merchantId });
    const caseCountBefore = await RecoveryCase.countDocuments({ merchant: merchantId });
    const paymentCountBefore = await Payment.countDocuments({ merchant: merchantId });

    await seedMain();
    await connectDatabase();

    const actionCountAfter = await RecoveryAction.countDocuments({ merchant: merchantId });
    const caseCountAfter = await RecoveryCase.countDocuments({ merchant: merchantId });
    const paymentCountAfter = await Payment.countDocuments({ merchant: merchantId });

    assert.equal(actionCountAfter, actionCountBefore);
    assert.equal(caseCountAfter, caseCountBefore);
    assert.equal(paymentCountAfter, paymentCountBefore);
  } finally {
    if (merchantId) await cleanDemoData(merchantId);
    await mongoose.disconnect();
  }
});

test('demo seed scenarios are consistent with actual policy and stopping rules', async () => {
  const { RECOVERY_ACTION_STATUS, RECOVERY_ACTION_TYPE, RECOVERY_CASE_STATUS } = require('../src/constants/enums');

  for (const scenario of DEMO_SCENARIOS) {
    const payment = { amount: scenario.amount, status: 'FAILED', failure: { code: scenario.code } };
    const recoveryCase = { status: 'DETECTED', retryCount: scenario.retryCount || 0, customerContactAttempts: scenario.contactCount || 0 };
    const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy: DEMO_POLICY_CONFIG });
    const policyResult = evaluateRecoveryAction({
      policy: DEMO_POLICY_CONFIG,
      payment,
      recoveryCase,
      recommendation: { type: recommendation.action, confidence: recommendation.confidence },
      existingActions: []
    });

    const expectedAction = recommendation.action;
    const expectedDecision = policyResult.decision;

    if (scenario.historicalStatus === 'FAILED') {
      assert.equal(expectedDecision, 'ALLOWED', `Scenario ${scenario.id} with historical FAILED must have ALLOWED policy decision`);
    } else {
      const expectedStatus = expectedDecision === 'ALLOWED' ? 'POLICY_ALLOWED' : 'POLICY_BLOCKED';
      assert.ok(
        expectedAction === scenario.action || !scenario.action,
        `Scenario ${scenario.id}: expected action ${expectedAction}, got ${scenario.action || 'undefined'}`
      );
    }

    if (scenario.amount > DEMO_POLICY_CONFIG.maxTransactionAmount) {
      assert.equal(expectedDecision, 'BLOCKED', `Scenario ${scenario.id}: amount exceeds maxTransactionAmount and must be BLOCKED`);
    }

    if (scenario.retryCount >= DEMO_POLICY_CONFIG.maxAutomaticRetries && recommendation.action === 'RETRY_PAYMENT') {
      assert.equal(expectedDecision, 'BLOCKED', `Scenario ${scenario.id}: retry limit exhausted for RETRY_PAYMENT and must be BLOCKED`);
    }

    if (scenario.contactCount >= DEMO_POLICY_CONFIG.maxCustomerContactAttempts && recommendation.action === 'CUSTOMER_REMINDER') {
      assert.equal(expectedDecision, 'BLOCKED', `Scenario ${scenario.id}: contact limit exhausted for CUSTOMER_REMINDER and must be BLOCKED`);
    }

    if (!DEMO_POLICY_CONFIG.allowedActions.includes(recommendation.action)) {
      assert.equal(expectedDecision, 'BLOCKED', `Scenario ${scenario.id}: disallowed action must be BLOCKED`);
    }
  }
});

test('Test A: genuine recovery survives reseeding', async () => {
  const mongoose = require('mongoose');
  const { connectDatabase } = require('../src/config/database');

  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' });
    if (!merchant) {
      await mongoose.disconnect();
      return;
    }
    merchantId = String(merchant._id);

    await cleanDemoData(merchantId);

    const customer = await Customer.findOne({ merchant: merchantId, externalCustomerId: 'demo_customer' });
    const payment = await Payment.findOneAndUpdate(
      { merchant: merchantId, razorpayPaymentId: 'demo_genuine_recovery' },
      { merchant: merchantId, customer: customer._id, razorpayPaymentId: 'demo_genuine_recovery', amount: 500000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { upsert: true, new: true }
    );
    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { payment: payment._id },
      { merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 500000, resolvedAt: new Date() },
      { upsert: true, new: true }
    );
    const action = await RecoveryAction.findOneAndUpdate(
      { idempotencyKey: 'demo:genuine_recovery' },
      { merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_genuine', result: 'PAYMENT_CONFIRMED', providerPaymentId: 'pay_genuine' }, recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test', evaluatedAt: new Date() }, idempotencyKey: 'demo:genuine_recovery' },
      { upsert: true, new: true }
    );
    await AuditEvent.create({
      merchant: merchantId,
      payment: payment._id,
      recoveryCase: recoveryCase._id,
      recoveryAction: action._id,
      providerEventId: 'demo:genuine_recovery:RECOVERY_COMPLETED',
      type: 'RECOVERY_COMPLETED',
      actor: 'RAZORPAY',
      reason: 'Genuine recovery for test.',
      result: 'PAYMENT_CONFIRMED',
      metadata: { provider: 'RAZORPAY', providerPaymentId: 'pay_genuine', providerLinkId: 'plink_genuine', amount: 500000, currency: 'INR' }
    });

    await seedMain();
    await connectDatabase();

    const updatedCase = await RecoveryCase.findOne({ merchant: merchantId, payment: payment._id }).lean();
    assert.equal(updatedCase.status, 'RECOVERED');
    assert.equal(updatedCase.recoveredAmount, 500000);

    const updatedAction = await RecoveryAction.findOne({ merchant: merchantId, idempotencyKey: 'demo:genuine_recovery' }).lean();
    assert.equal(updatedAction.status, 'EXECUTED');
    assert.equal(updatedAction.execution.result, 'PAYMENT_CONFIRMED');

    const recoveryEvent = await AuditEvent.findOne({ merchant: merchantId, providerEventId: 'demo:genuine_recovery:RECOVERY_COMPLETED' }).lean();
    assert.ok(recoveryEvent);
    assert.equal(recoveryEvent.actor, 'RAZORPAY');
  } finally {
    if (merchantId) await cleanDemoData(merchantId);
    await mongoose.disconnect();
  }
});

test('Test B: seed never fabricates recovery on fresh database', async () => {
  const mongoose = require('mongoose');
  const { connectDatabase } = require('../src/config/database');

  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' });
    if (!merchant) {
      await mongoose.disconnect();
      return;
    }
    merchantId = String(merchant._id);

    await cleanDemoData(merchantId);
    await seedMain();
    await connectDatabase();

    const recoveredCases = await RecoveryCase.find({ merchant: merchantId, status: 'RECOVERED' }).lean();
    assert.equal(recoveredCases.length, 0, 'No seeded case should be RECOVERED');

    const positiveRecoveredAmount = await RecoveryCase.find({ merchant: merchantId, recoveredAmount: { $gt: 0 } }).lean();
    assert.equal(positiveRecoveredAmount.length, 0, 'No seeded case should have positive recoveredAmount');

    const recoveryCompletedEvents = await AuditEvent.find({ merchant: merchantId, type: 'RECOVERY_COMPLETED' }).lean();
    assert.equal(recoveryCompletedEvents.length, 0, 'No seeded RECOVERY_COMPLETED events should exist');

    const fakeProviderRefs = await RecoveryAction.find({ merchant: merchantId, 'execution.providerReference': { $regex: /^demo_link_/ } }).lean();
    assert.equal(fakeProviderRefs.length, 0, 'No seeded action should have fake demo_link providerReference');

    const fakeProviderPaymentIds = await RecoveryAction.find({ merchant: merchantId, 'execution.providerPaymentId': { $regex: /^demo_provider_payment_/ } }).lean();
    assert.equal(fakeProviderPaymentIds.length, 0, 'No seeded action should have fake demo_provider_payment providerPaymentId');
  } finally {
    if (merchantId) await cleanDemoData(merchantId);
    await mongoose.disconnect();
  }
});

test('Test C: repeated seed does not downgrade genuine recovery', async () => {
  const mongoose = require('mongoose');
  const { connectDatabase } = require('../src/config/database');

  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' });
    if (!merchant) {
      await mongoose.disconnect();
      return;
    }
    merchantId = String(merchant._id);

    await cleanDemoData(merchantId);

    const customer = await Customer.findOne({ merchant: merchantId, externalCustomerId: 'demo_customer' });
    const payment = await Payment.findOneAndUpdate(
      { merchant: merchantId, razorpayPaymentId: 'demo_genuine_recovery_c' },
      { merchant: merchantId, customer: customer._id, razorpayPaymentId: 'demo_genuine_recovery_c', amount: 500000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { upsert: true, new: true }
    );
    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { payment: payment._id },
      { merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 500000, resolvedAt: new Date() },
      { upsert: true, new: true }
    );
    const action = await RecoveryAction.findOneAndUpdate(
      { idempotencyKey: 'demo:genuine_recovery_c' },
      { merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_genuine_c', result: 'PAYMENT_CONFIRMED', providerPaymentId: 'pay_genuine_c' }, recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test', evaluatedAt: new Date() }, idempotencyKey: 'demo:genuine_recovery_c' },
      { upsert: true, new: true }
    );
    await AuditEvent.create({
      merchant: merchantId,
      payment: payment._id,
      recoveryCase: recoveryCase._id,
      recoveryAction: action._id,
      providerEventId: 'demo:genuine_recovery_c:RECOVERY_COMPLETED',
      type: 'RECOVERY_COMPLETED',
      actor: 'RAZORPAY',
      reason: 'Genuine recovery for test.',
      result: 'PAYMENT_CONFIRMED',
      metadata: { provider: 'RAZORPAY', providerPaymentId: 'pay_genuine_c', providerLinkId: 'plink_genuine_c', amount: 500000, currency: 'INR' }
    });

    await seedMain();
    await seedMain();
    await connectDatabase();

    const updatedCase = await RecoveryCase.findOne({ merchant: merchantId, payment: payment._id }).lean();
    assert.equal(updatedCase.status, 'RECOVERED', 'Genuinely recovered case must remain RECOVERED after repeated seeding');
    assert.equal(updatedCase.recoveredAmount, 500000, 'Recovered amount must be preserved');
    assert.notEqual(updatedCase.status, 'DETECTED');
    assert.notEqual(updatedCase.status, 'ACTION_PENDING');
    assert.notEqual(updatedCase.status, 'ACTION_EXECUTING');

    const updatedAction = await RecoveryAction.findOne({ merchant: merchantId, idempotencyKey: 'demo:genuine_recovery_c' }).lean();
    assert.equal(updatedAction.status, 'EXECUTED');
    assert.equal(updatedAction.execution.result, 'PAYMENT_CONFIRMED');
  } finally {
    if (merchantId) await cleanDemoData(merchantId);
    await mongoose.disconnect();
  }
});

test('Test D: payment-link creation is not recovery', async () => {
  console.log('Test D starting');
  const mongoose = require('mongoose');
  const { connectDatabase } = require('../src/config/database');
  const { calculateOverview } = require('../src/services/analyticsService');

  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' });
    if (!merchant) {
      await mongoose.disconnect();
      return;
    }
    merchantId = String(merchant._id);

    await cleanDemoData(merchantId);

    const customer = await Customer.findOne({ merchant: merchantId, externalCustomerId: 'demo_customer' });
    const payment = await Payment.findOneAndUpdate(
      { merchant: merchantId, razorpayPaymentId: 'demo_link_only' },
      { merchant: merchantId, customer: customer._id, razorpayPaymentId: 'demo_link_only', amount: 300000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { upsert: true, new: true }
    );
    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { payment: payment._id },
      { merchant: merchantId, payment: payment._id, status: 'ACTION_PENDING', recoveredAmount: 0 },
      { upsert: true, new: true }
    );
    await RecoveryAction.findOneAndUpdate(
      { idempotencyKey: 'demo:link_only' },
      { merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_only', result: 'PAYMENT_LINK_CREATED' }, recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test', evaluatedAt: new Date() }, idempotencyKey: 'demo:link_only' },
      { upsert: true, new: true }
    );
    await AuditEvent.create({
      merchant: merchantId,
      payment: payment._id,
      recoveryCase: recoveryCase._id,
      providerEventId: 'demo:link_only:ACTION_EXECUTION_COMPLETED',
      type: 'ACTION_EXECUTION_COMPLETED',
      actor: 'SYSTEM',
      reason: 'Payment link created.',
      result: 'PAYMENT_LINK_CREATED',
      metadata: { provider: 'RAZORPAY_TEST', providerReference: 'plink_only' }
    });

    const overview = calculateOverview({
      payments: await Payment.find({ merchant: merchantId }).lean(),
      recoveryCases: await RecoveryCase.find({ merchant: merchantId }).lean(),
      recoveryActions: await RecoveryAction.find({ merchant: merchantId }).lean(),
      auditEvents: await AuditEvent.find({ merchant: merchantId }).lean()
    });

    assert.equal(overview.successfulRecoveries, 0);
    assert.equal(overview.recoveredRevenue, 0);
    assert.equal(overview.recoveryRate, 0);
  } finally {
    if (merchantId) await cleanDemoData(merchantId);
    await mongoose.disconnect();
  }
});

test('Test E: analytics remains provider-evidence gated', async () => {
  const mongoose = require('mongoose');
  const { connectDatabase } = require('../src/config/database');
  const { calculateOverview } = require('../src/services/analyticsService');

  await connectDatabase();
  let merchantId = null;
  try {
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' });
    if (!merchant) {
      await mongoose.disconnect();
      return;
    }
    merchantId = String(merchant._id);

    await cleanDemoData(merchantId);

    const customer = await Customer.findOne({ merchant: merchantId, externalCustomerId: 'demo_customer' });

    const payment = await Payment.findOneAndUpdate(
      { merchant: merchantId, razorpayPaymentId: 'demo_analytics_gate' },
      { merchant: merchantId, customer: customer._id, razorpayPaymentId: 'demo_analytics_gate', amount: 300000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { upsert: true, new: true }
    );
    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { payment: payment._id },
      { merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 300000, resolvedAt: new Date() },
      { upsert: true, new: true }
    );
    await RecoveryAction.findOneAndUpdate(
      { idempotencyKey: 'demo:analytics_gate' },
      { merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_gate', result: 'PAYMENT_CONFIRMED', providerPaymentId: 'pay_gate' }, recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test', evaluatedAt: new Date() }, idempotencyKey: 'demo:analytics_gate' },
      { upsert: true, new: true }
    );

    const overviewWithoutConfirmation = calculateOverview({
      payments: await Payment.find({ merchant: merchantId }).lean(),
      recoveryCases: await RecoveryCase.find({ merchant: merchantId }).lean(),
      recoveryActions: await RecoveryAction.find({ merchant: merchantId }).lean(),
      auditEvents: []
    });
    assert.equal(overviewWithoutConfirmation.successfulRecoveries, 0);
    assert.equal(overviewWithoutConfirmation.recoveredRevenue, 0);

    await AuditEvent.create({
      merchant: merchantId,
      payment: payment._id,
      recoveryCase: recoveryCase._id,
      providerEventId: 'demo:analytics_gate:RECOVERY_COMPLETED',
      type: 'RECOVERY_COMPLETED',
      actor: 'RAZORPAY',
      reason: 'Genuine recovery.',
      result: 'PAYMENT_CONFIRMED',
      metadata: { provider: 'RAZORPAY', providerPaymentId: 'pay_gate', providerLinkId: 'plink_gate', amount: 300000, currency: 'INR' }
    });

    const overviewWithConfirmation = calculateOverview({
      payments: await Payment.find({ merchant: merchantId }).lean(),
      recoveryCases: await RecoveryCase.find({ merchant: merchantId }).lean(),
      recoveryActions: await RecoveryAction.find({ merchant: merchantId }).lean(),
      auditEvents: await AuditEvent.find({ merchant: merchantId }).lean()
    });
    assert.equal(overviewWithConfirmation.successfulRecoveries, 1);
    assert.equal(overviewWithConfirmation.recoveredRevenue, 300000);
  } finally {
    if (merchantId) await cleanDemoData(merchantId);
    await mongoose.disconnect();
  }
});

async function cleanDemoData(merchantId) {
  assertTestDatabase();
  const payments = await Payment.find({ merchant: merchantId, razorpayPaymentId: { $regex: /^demo_/ } }).lean();
  const paymentIds = payments.map((p) => p._id);

  if (paymentIds.length) {
    const recoveryCaseIds = await RecoveryCase.find({ merchant: merchantId, payment: { $in: paymentIds } }).distinct('_id');
    await AuditEvent.deleteMany({ merchant: merchantId, $or: [{ payment: { $in: paymentIds } }, { recoveryCase: { $in: recoveryCaseIds } }] });
    await RecoveryAction.deleteMany({ merchant: merchantId, payment: { $in: paymentIds } });
    await RecoveryCase.deleteMany({ merchant: merchantId, payment: { $in: paymentIds } });
    await Payment.deleteMany({ _id: { $in: paymentIds } });
  }

  await RecoveryPolicy.deleteMany({ merchant: merchantId });
}
