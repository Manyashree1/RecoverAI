const test = require('node:test');
const assert = require('node:assert/strict');
const { WebhookIngestionService } = require('../src/services/webhookIngestionService');
const { PAYMENT_STATUS, AUDIT_EVENT_TYPE } = require('../src/constants/enums');
const { failedPaymentEvent, capturedPaymentEvent, paymentLinkPaidEvent, paymentLinkPartiallyPaidEvent } = require('./fixtures/razorpayPaymentEvents');
const { InMemoryWebhookRepository, InMemoryTransactionRunner, duplicateKeyError } = require('./helpers/inMemoryWebhookRepository');
const { calculateOverview } = require('../src/services/analyticsService');

function createService(options) {
  const repository = new InMemoryWebhookRepository(options);
  return { repository, service: new WebhookIngestionService({ repository, transactionRunner: new InMemoryTransactionRunner(repository) }) };
}

function seedExecutedRecovery(repository, { merchantId = 'merchant_001', actionId = 'action_001', paymentId = 'payment_recovery_001', caseId = 'case_recovery_001' } = {}) {
  repository.state.payments.push({ _id: paymentId, merchant: merchantId, amount: 499900, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  repository.state.recoveryCases.push({ _id: caseId, merchant: merchantId, payment: paymentId, status: 'ACTION_PENDING', recoveredAmount: 0, retryCount: 0, customerContactAttempts: 1 });
  repository.state.recoveryActions.push({ _id: actionId, merchant: merchantId, payment: paymentId, recoveryCase: caseId, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_001', result: 'PAYMENT_LINK_CREATED' } });
}

test('valid failed payment creates payment, recovery case, and audit trail', async () => {
  const { repository, service } = createService();

  const result = await service.ingestRazorpayPaymentEvent({ providerEventId: 'evt_failed_001', payload: failedPaymentEvent() });

  assert.equal(result.duplicate, false);
  assert.equal(repository.state.payments.length, 1);
  assert.equal(repository.state.payments[0].status, PAYMENT_STATUS.FAILED);
  assert.equal(repository.state.recoveryCases.length, 1);
  assert.deepEqual(
    repository.state.auditEvents.map((event) => event.type).sort(),
    [AUDIT_EVENT_TYPE.PAYMENT_FAILED, AUDIT_EVENT_TYPE.RECOVERY_CASE_CREATED].sort()
  );
  assert.equal(repository.state.webhookEvents[0].status, 'PROCESSED');
});

test('duplicate Razorpay event ID is acknowledged without duplicate recovery records', async () => {
  const { repository, service } = createService();
  const input = { providerEventId: 'evt_duplicate_001', payload: failedPaymentEvent() };

  await service.ingestRazorpayPaymentEvent(input);
  const result = await service.ingestRazorpayPaymentEvent(input);

  assert.equal(result.duplicate, true);
  assert.equal(repository.state.payments.length, 1);
  assert.equal(repository.state.recoveryCases.length, 1);
  assert.equal(repository.state.auditEvents.length, 2);
});

test('captured payment is recorded without opening a recovery case', async () => {
  const { repository, service } = createService();

  await service.ingestRazorpayPaymentEvent({ providerEventId: 'evt_captured_001', payload: capturedPaymentEvent() });

  assert.equal(repository.state.payments.length, 1);
  assert.equal(repository.state.payments[0].status, PAYMENT_STATUS.CAPTURED);
  assert.equal(repository.state.recoveryCases.length, 0);
  assert.equal(repository.state.auditEvents[0].type, AUDIT_EVENT_TYPE.PAYMENT_CAPTURED);
});

test('authorized payment is recorded without opening a recovery case', async () => {
  const { repository, service } = createService();

  await service.ingestRazorpayPaymentEvent({
    providerEventId: 'evt_authorized_001',
    payload: failedPaymentEvent({ event: 'payment.authorized' })
  });

  assert.equal(repository.state.payments.length, 1);
  assert.equal(repository.state.payments[0].status, PAYMENT_STATUS.AUTHORIZED);
  assert.equal(repository.state.recoveryCases.length, 0);
  assert.equal(repository.state.auditEvents[0].type, AUDIT_EVENT_TYPE.PAYMENT_AUTHORIZED);
});

test('malformed payment payload is rejected before database state is created', async () => {
  const { repository, service } = createService();

  await assert.rejects(
    service.ingestRazorpayPaymentEvent({
      providerEventId: 'evt_malformed_001',
      payload: { event: 'payment.failed', account_id: 'acc_test_recoverai', payload: {} }
    }),
    (error) => error.statusCode === 400
  );

  assert.equal(repository.state.webhookEvents.length, 0);
  assert.equal(repository.state.payments.length, 0);
  assert.equal(repository.state.recoveryCases.length, 0);
  assert.equal(repository.state.auditEvents.length, 0);
});

test('captured event after a failure closes the existing recovery case without recovery execution', async () => {
  const { repository, service } = createService();

  await service.ingestRazorpayPaymentEvent({ providerEventId: 'evt_failed_then_captured_001', payload: failedPaymentEvent() });
  await service.ingestRazorpayPaymentEvent({ providerEventId: 'evt_captured_after_failure_001', payload: capturedPaymentEvent() });

  assert.equal(repository.state.payments[0].status, PAYMENT_STATUS.CAPTURED);
  assert.equal(repository.state.recoveryCases[0].status, 'CLOSED');
  assert.deepEqual(
    repository.state.auditEvents.map((event) => event.type).sort(),
    [
      AUDIT_EVENT_TYPE.PAYMENT_FAILED,
      AUDIT_EVENT_TYPE.RECOVERY_CASE_CREATED,
      AUDIT_EVENT_TYPE.PAYMENT_CAPTURED,
      AUDIT_EVENT_TYPE.RECOVERY_CASE_CLOSED
    ].sort()
  );
});

test('duplicate-key conflict for an already-recorded provider event is handled gracefully', async () => {
  const { repository, service } = createService();
  repository.state.webhookEvents.push({ _id: 'webhook_existing', provider: 'RAZORPAY', providerEventId: 'evt_conflict_001' });

  const result = await service.ingestRazorpayPaymentEvent({ providerEventId: 'evt_conflict_001', payload: failedPaymentEvent() });

  assert.equal(result.duplicate, true);
  assert.equal(repository.state.payments.length, 0);
  assert.equal(repository.state.recoveryCases.length, 0);
});

test('valid Payment Link confirmation recovers the correlated case with provider amount', async () => {
  const { repository, service } = createService();
  seedExecutedRecovery(repository);

  const result = await service.ingestRazorpayPaymentEvent({
    providerEventId: 'evt_recovery_paid_001',
    payload: paymentLinkPaidEvent({ referenceId: 'ra_action_001', amountPaid: 510000 })
  });

  assert.equal(result.recovered, true);
  assert.equal(repository.state.recoveryActions[0].execution.result, 'PAYMENT_CONFIRMED');
  // The recovery payment is represented SEPARATELY by the executed action's
  // providerPaymentId — never by rewriting the original failed payment.
  assert.equal(repository.state.recoveryActions[0].execution.providerPaymentId, 'pay_recovery_001');
  assert.equal(repository.state.payments.length, 1);
  // REGRESSION: the original failed payment keeps its historical status,
  // failure signal, and amount after a successful recovery.
  assert.equal(repository.state.payments[0].status, PAYMENT_STATUS.FAILED);
  assert.equal(repository.state.payments[0].failure?.code, 'insufficient_funds');
  assert.equal(repository.state.payments[0].amount, 499900);
  assert.equal(repository.state.recoveryCases[0].status, 'RECOVERED');
  // recoveredAmount comes from the VERIFIED recovery payment (510000), not
  // from the original failed payment's amount (499900).
  assert.equal(repository.state.recoveryCases[0].recoveredAmount, 510000);
  assert.equal(repository.state.auditEvents[0].type, AUDIT_EVENT_TYPE.RECOVERY_COMPLETED);
  assert.equal(repository.state.auditEvents[0].actor, 'RAZORPAY');
});

test('partial Payment Link payment is recorded as partial evidence and does not recover the case', async () => {
  const { repository, service } = createService();
  seedExecutedRecovery(repository);

  const result = await service.ingestRazorpayPaymentEvent({
    providerEventId: 'evt_recovery_partial_001',
    payload: paymentLinkPartiallyPaidEvent()
  });

  assert.equal(result.partial, true);
  assert.equal(result.recovered, false);
  assert.equal(repository.state.recoveryActions[0].execution.result, 'PAYMENT_LINK_CREATED');
  assert.equal(repository.state.recoveryCases[0].status, 'ACTION_PENDING');
  assert.equal(repository.state.recoveryCases[0].recoveredAmount, 0);
  assert.equal(repository.state.auditEvents[0].type, AUDIT_EVENT_TYPE.RECOVERY_PARTIAL_PAYMENT);
});

test('duplicate Payment Link confirmation is idempotent and counted once', async () => {
  const { repository, service } = createService();
  seedExecutedRecovery(repository);
  const input = { providerEventId: 'evt_recovery_paid_002', payload: paymentLinkPaidEvent({ referenceId: 'ra_action_001', paymentId: 'pay_recovery_002', amountPaid: 510000 }) };

  await service.ingestRazorpayPaymentEvent(input);
  const result = await service.ingestRazorpayPaymentEvent(input);
  const metrics = calculateOverview(repository.state);

  assert.equal(result.duplicate, true);
  assert.equal(repository.state.recoveryCases[0].recoveredAmount, 510000);
  assert.equal(repository.state.auditEvents.filter((event) => event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED).length, 1);
  assert.equal(metrics.successfulRecoveries, 1);
  assert.equal(metrics.recoveredRevenue, 510000);
});

test('duplicate Payment Link confirmation replay never rewrites the original failed payment', async () => {
  const { repository, service } = createService();
  seedExecutedRecovery(repository);
  repository.state.recoveryActions[0].execution.providerPaymentId = 'pay_recovery_001';
  repository.state.recoveryActions[0].execution.result = 'PAYMENT_CONFIRMED';
  repository.state.recoveryCases[0].status = 'RECOVERED';
  repository.state.recoveryCases[0].recoveredAmount = 510000;
  repository.state.auditEvents.push({ type: AUDIT_EVENT_TYPE.RECOVERY_COMPLETED, providerEventId: 'evt_recovery_paid_replay_001' });

  repository.state.payments[0].status = 'FAILED';
  const input = { providerEventId: 'evt_recovery_paid_replay_001', payload: paymentLinkPaidEvent({ referenceId: 'ra_action_001', amountPaid: 510000 }) };
  // First delivery records the webhook event (the action was already
  // confirmed, so confirmation itself is a no-op).
  await service.ingestRazorpayPaymentEvent(input);
  repository.state.payments[0].status = 'FAILED';

  // Replay of the same signed event takes the idempotent reconciliation path.
  const result = await service.ingestRazorpayPaymentEvent(input);

  // The idempotent replay reconciles without touching historical evidence:
  // the original failed payment must NOT be resurrected as CAPTURED merely
  // because its recovery journey's separate provider payment succeeded.
  assert.equal(result.duplicate, true);
  assert.equal(repository.state.payments[0].status, PAYMENT_STATUS.FAILED);
  assert.equal(repository.state.auditEvents.filter((event) => event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED).length, 1);
});

test('unrelated successful Payment Link never creates or recovers a case', async () => {
  const { repository, service } = createService();

  const result = await service.ingestRazorpayPaymentEvent({
    providerEventId: 'evt_unrelated_link_paid_001',
    payload: paymentLinkPaidEvent({ referenceId: 'ra_not_ours', paymentId: 'pay_unrelated_001' })
  });

  assert.equal(result.ignored, true);
  assert.equal(repository.state.payments.length, 0);
  assert.equal(repository.state.recoveryCases.length, 0);
  assert.equal(repository.state.recoveryActions.length, 0);
  assert.equal(repository.state.auditEvents.length, 0);
});

test('Payment Link confirmation cannot recover an action belonging to another merchant', async () => {
  const { repository, service } = createService();
  seedExecutedRecovery(repository, { merchantId: 'merchant_002', actionId: 'action_002', paymentId: 'payment_other', caseId: 'case_other' });

  const result = await service.ingestRazorpayPaymentEvent({
    providerEventId: 'evt_cross_merchant_link_paid_001',
    payload: paymentLinkPaidEvent({ referenceId: 'ra_action_002', paymentLinkId: 'plink_001' })
  });

  assert.equal(result.ignored, true);
  assert.equal(repository.state.recoveryCases[0].status, 'ACTION_PENDING');
  assert.equal(repository.state.recoveryCases[0].recoveredAmount, 0);
});

test('transaction rollback leaves no partial payment or case when audit persistence fails', async () => {
  const { repository, service } = createService({ failAuditEvent: true });

  await assert.rejects(
    service.ingestRazorpayPaymentEvent({ providerEventId: 'evt_rollback_001', payload: failedPaymentEvent() }),
    /Simulated database failure/
  );

  assert.equal(repository.state.webhookEvents.length, 0);
  assert.equal(repository.state.payments.length, 0);
  assert.equal(repository.state.recoveryCases.length, 0);
  assert.equal(repository.state.auditEvents.length, 0);
});

test('unrelated duplicate key errors are not swallowed as webhook duplicates', async () => {
  const { repository, service } = createService();
  repository.createAuditEvent = async () => { throw duplicateKeyError(); };

  await assert.rejects(
    service.ingestRazorpayPaymentEvent({ providerEventId: 'evt_unrelated_conflict_001', payload: failedPaymentEvent() }),
    /Duplicate key/
  );
});

test('payment_link.paid for a single unbound demo merchant resolves and recovers the correlated case', async () => {
  const { repository, service } = createService();
  // One ACTIVE demo merchant with no bound account id; payload account_id does
  // not match any configured merchant. HMAC was verified by the controller.
  repository.state.merchants = [{ _id: 'merchant_demo', name: 'RecoverAI Demo Merchant', status: 'ACTIVE' }];
  repository.state.payments.push({ _id: 'payment_recovery_001', merchant: 'merchant_demo', amount: 75000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  repository.state.recoveryCases.push({ _id: 'case_recovery_001', merchant: 'merchant_demo', payment: 'payment_recovery_001', status: 'ACTION_PENDING', recoveredAmount: 0, retryCount: 0, customerContactAttempts: 1 });
  repository.state.recoveryActions.push({ _id: 'action_001', merchant: 'merchant_demo', payment: 'payment_recovery_001', recoveryCase: 'case_recovery_001', type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_001', result: 'PAYMENT_LINK_CREATED' } });

  const result = await service.ingestRazorpayPaymentEvent({
    providerEventId: 'evt_demo_unbound_paid_001',
    payload: paymentLinkPaidEvent({ referenceId: 'ra_action_001', paymentLinkId: 'plink_001', paymentId: 'pay_new_demo_001', amountPaid: 75000, accountId: 'acc_test_unbound_not_configured' })
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.ignored, false);
  assert.equal(result.recovered, true);
  assert.equal(repository.state.recoveryCases[0].status, 'RECOVERED');
  assert.equal(repository.state.recoveryCases[0].recoveredAmount, 75000);
  // REGRESSION: the original failed payment is untouched by the recovery.
  assert.equal(repository.state.payments.length, 1);
  assert.equal(repository.state.payments[0].status, 'FAILED');
  assert.equal(repository.state.payments[0].failure?.code, 'insufficient_funds');
  assert.equal(repository.state.recoveryActions[0].execution.providerPaymentId, 'pay_new_demo_001');
  assert.equal(repository.state.recoveryActions[0].execution.result, 'PAYMENT_CONFIRMED');
  const completion = repository.state.auditEvents.find((event) => event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED);
  assert.equal(completion?.actor, 'RAZORPAY');
  assert.equal(completion?.metadata?.amount, 75000);
});

test('an unbound demo merchant is not resolved when more than one demo merchant exists', async () => {
  const { repository, service } = createService();
  repository.state.merchants = [
    { _id: 'merchant_demo_a', name: 'RecoverAI Demo Merchant', status: 'ACTIVE' },
    { _id: 'merchant_demo_b', name: 'RecoverAI Demo Merchant', status: 'ACTIVE' }
  ];

  // Ambiguous -> no merchant resolved -> 503 so Razorpay retries after repair.
  await assert.rejects(
    service.ingestRazorpayPaymentEvent({ providerEventId: 'evt_ambiguous_001', payload: paymentLinkPaidEvent({ referenceId: 'ra_action_001', paymentLinkId: 'plink_001' }) }),
    (error) => error.statusCode === 503
  );
});
