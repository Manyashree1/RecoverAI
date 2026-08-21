const test = require('node:test');
const assert = require('node:assert/strict');
const { WebhookIngestionService } = require('../src/services/webhookIngestionService');
const { PAYMENT_STATUS, AUDIT_EVENT_TYPE } = require('../src/constants/enums');
const { failedPaymentEvent, capturedPaymentEvent } = require('./fixtures/razorpayPaymentEvents');
const { InMemoryWebhookRepository, InMemoryTransactionRunner, duplicateKeyError } = require('./helpers/inMemoryWebhookRepository');

function createService(options) {
  const repository = new InMemoryWebhookRepository(options);
  return { repository, service: new WebhookIngestionService({ repository, transactionRunner: new InMemoryTransactionRunner(repository) }) };
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
