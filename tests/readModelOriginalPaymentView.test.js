const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOriginalPaymentView, buildEvidenceSummary } = require('../src/repositories/readRepository');
const { PAYMENT_STATUS, AUDIT_EVENT_TYPE } = require('../src/constants/enums');

test('buildOriginalPaymentView derives FAILED status from earliest PAYMENT_FAILED audit event', () => {
  const payment = { _id: 'p1', status: PAYMENT_STATUS.CAPTURED, amount: 75000, currency: 'INR', failure: { code: 'insufficient_funds' }, createdAt: new Date('2024-01-01') };
  const caseCreatedAt = new Date('2024-01-02');
  const failureEvents = [
    { type: AUDIT_EVENT_TYPE.PAYMENT_FAILED, createdAt: new Date('2024-01-01T10:00:00Z'), error: 'insufficient_funds', reason: 'Insufficient Funds' }
  ];

  const view = buildOriginalPaymentView(payment, caseCreatedAt, failureEvents);

  assert.equal(view.status, PAYMENT_STATUS.FAILED);
  assert.equal(view.failure.code, 'insufficient_funds');
  assert.equal(view.failure.description, 'Insufficient Funds');
  assert.equal(view.triggerEvidenceAvailable, true);
});

test('buildOriginalPaymentView derives FAILED status from payment.failure.code when no audit event exists', () => {
  const payment = { _id: 'p1', status: PAYMENT_STATUS.CAPTURED, amount: 75000, currency: 'INR', failure: { code: 'payment_timeout', description: 'Timeout', occurredAt: new Date('2024-01-01T09:00:00Z') }, createdAt: new Date('2024-01-01') };
  const caseCreatedAt = new Date('2024-01-02');

  const view = buildOriginalPaymentView(payment, caseCreatedAt, []);

  assert.equal(view.status, PAYMENT_STATUS.FAILED);
  assert.equal(view.failure.code, 'payment_timeout');
  assert.equal(view.failure.description, 'Timeout');
  assert.equal(view.triggerEvidenceAvailable, true);
});

test('buildOriginalPaymentView falls back to current status when no trigger evidence exists', () => {
  const payment = { _id: 'p1', status: PAYMENT_STATUS.CREATED, amount: 75000, currency: 'INR', createdAt: new Date('2024-01-01') };
  const caseCreatedAt = new Date('2024-01-02');

  const view = buildOriginalPaymentView(payment, caseCreatedAt, []);

  assert.equal(view.status, PAYMENT_STATUS.CREATED);
  assert.equal(view.triggerEvidenceAvailable, false);
});

test('buildOriginalPaymentView preserves original amount and currency regardless of current status', () => {
  const payment = { _id: 'p1', status: PAYMENT_STATUS.CAPTURED, amount: 75000, currency: 'INR', razorpayPaymentId: 'pay_123', failure: { code: 'insufficient_funds' }, createdAt: new Date('2024-01-01') };
  const caseCreatedAt = new Date('2024-01-02');
  const failureEvents = [
    { type: AUDIT_EVENT_TYPE.PAYMENT_FAILED, createdAt: new Date('2024-01-01T10:00:00Z') }
  ];

  const view = buildOriginalPaymentView(payment, caseCreatedAt, failureEvents);

  assert.equal(view.amount, 75000);
  assert.equal(view.currency, 'INR');
  assert.equal(view.razorpayPaymentId, 'pay_123');
});

test('buildEvidenceSummary counts events and surfaces key recovery milestones', () => {
  const events = [
    { type: AUDIT_EVENT_TYPE.PAYMENT_FAILED, createdAt: new Date('2024-01-01T10:00:00Z') },
    { type: AUDIT_EVENT_TYPE.RECOVERY_CASE_CREATED, createdAt: new Date('2024-01-01T10:01:00Z') },
    { type: AUDIT_EVENT_TYPE.POLICY_EVALUATED, createdAt: new Date('2024-01-01T10:02:00Z') },
    { type: AUDIT_EVENT_TYPE.ACTION_EXECUTION_STARTED, createdAt: new Date('2024-01-01T10:03:00Z') },
    { type: AUDIT_EVENT_TYPE.ACTION_EXECUTION_COMPLETED, createdAt: new Date('2024-01-01T10:04:00Z') },
    { type: AUDIT_EVENT_TYPE.RECOVERY_COMPLETED, createdAt: new Date('2024-01-01T10:05:00Z') }
  ];

  const summary = buildEvidenceSummary(events);

  assert.equal(summary.total, 6);
  assert.equal(summary.keyEvents.length, 4);
  assert.equal(summary.keyEvents[0].type, AUDIT_EVENT_TYPE.PAYMENT_FAILED);
  assert.equal(summary.keyEvents[1].type, AUDIT_EVENT_TYPE.POLICY_EVALUATED);
  assert.equal(summary.keyEvents[2].type, 'PAYMENT_LINK_CREATED');
  assert.equal(summary.keyEvents[3].type, AUDIT_EVENT_TYPE.RECOVERY_COMPLETED);
});

test('buildEvidenceSummary tracks latest event timestamp', () => {
  const earlier = new Date('2024-01-01T10:00:00Z');
  const later = new Date('2024-01-01T12:00:00Z');
  const events = [
    { type: 'OTHER', createdAt: earlier },
    { type: 'LATER', createdAt: later }
  ];

  const summary = buildEvidenceSummary(events);

  assert.ok(summary.lastEventAt);
  assert.equal(summary.lastEventAt.getTime(), later.getTime());
});
