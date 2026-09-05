const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOverview, calculatePerformance } = require('../src/services/analyticsService');

const RECOVERY_CASE_STATUS = { DETECTED: 'DETECTED', RECOVERED: 'RECOVERED', CLOSED: 'CLOSED', ACTION_PENDING: 'ACTION_PENDING', ACTION_EXECUTING: 'ACTION_EXECUTING' };
const RECOVERY_ACTION_STATUS = { EXECUTED: 'EXECUTED', POLICY_ALLOWED: 'POLICY_ALLOWED', POLICY_BLOCKED: 'POLICY_BLOCKED', BLOCKED: 'BLOCKED', FAILED: 'FAILED', EXECUTING: 'EXECUTING' };
const RECOVERY_ACTION_TYPE = { CUSTOMER_REMINDER: 'CUSTOMER_REMINDER', RETRY_PAYMENT: 'RETRY_PAYMENT', ESCALATE_TO_HUMAN: 'ESCALATE_TO_HUMAN' };
const AUDIT_EVENT_TYPE = { RECOVERY_COMPLETED: 'RECOVERY_COMPLETED', AI_FALLBACK_USED: 'AI_FALLBACK_USED' };
const ACTOR_TYPE = { RAZORPAY: 'RAZORPAY', SYSTEM: 'SYSTEM' };

test('calculateOverview includes recovery funnel with correct counts', () => {
  const data = {
    payments: [
      { _id: 'p1', amount: 10000, status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { _id: 'p2', amount: 20000, status: 'FAILED', failure: { code: 'card_declined' } },
      { _id: 'p3', amount: 30000, status: 'FAILED', failure: { code: 'payment_timeout' } }
    ],
    recoveryCases: [
      { _id: 'c1', payment: 'p1', status: RECOVERY_CASE_STATUS.RECOVERED, recoveredAmount: 10000, diagnosis: { explanation: 'Temporary failure' } },
      { _id: 'c2', payment: 'p2', status: RECOVERY_CASE_STATUS.DETECTED, recoveredAmount: 0, diagnosis: null },
      { _id: 'c3', payment: 'p3', status: RECOVERY_CASE_STATUS.ACTION_PENDING, recoveredAmount: 0, diagnosis: { explanation: 'Timeout' } }
    ],
    recoveryActions: [
      { recoveryCase: 'c1', type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER, status: RECOVERY_ACTION_STATUS.EXECUTED, execution: { providerReference: 'plink_1' } },
      { recoveryCase: 'c3', type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER, status: RECOVERY_ACTION_STATUS.POLICY_ALLOWED, execution: {} }
    ],
    auditEvents: [
      { recoveryCase: 'c1', type: AUDIT_EVENT_TYPE.RECOVERY_COMPLETED, actor: ACTOR_TYPE.RAZORPAY }
    ]
  };

  const m = calculateOverview(data);

  assert.ok(m.funnel);
  assert.equal(m.funnel.detected.count, 3);
  assert.equal(m.funnel.detected.amount, 60000);
  assert.equal(m.funnel.diagnosed.count, 2);
  assert.equal(m.funnel.recommended.count, 2);
  assert.equal(m.funnel.policyAllowed.count, 1);
  assert.equal(m.funnel.executed.count, 1);
  assert.equal(m.funnel.recovered.count, 1);
  assert.equal(m.funnel.recovered.amount, 10000);
});

test('calculateOverview counts escalated cases correctly', () => {
  const data = {
    payments: [
      { _id: 'p1', amount: 10000, status: 'FAILED', failure: {} },
      { _id: 'p2', amount: 20000, status: 'FAILED', failure: {} }
    ],
    recoveryCases: [
      { _id: 'c1', payment: 'p1', status: RECOVERY_CASE_STATUS.DETECTED, recoveredAmount: 0 },
      { _id: 'c2', payment: 'p2', status: RECOVERY_CASE_STATUS.DETECTED, recoveredAmount: 0 }
    ],
    recoveryActions: [
      { recoveryCase: 'c1', type: RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN, status: RECOVERY_ACTION_STATUS.POLICY_BLOCKED, policyDecision: { decision: 'BLOCKED', reason: 'Max retries exhausted' } },
      { recoveryCase: 'c2', type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER, status: RECOVERY_ACTION_STATUS.EXECUTED, execution: { providerReference: 'plink_2' } }
    ],
    auditEvents: []
  };

  const m = calculateOverview(data);

  assert.equal(m.escalatedCases, 1);
  assert.equal(m.escalatedAmount, 10000);
});

test('calculateOverview computes blocked amount from blocked actions', () => {
  const data = {
    payments: [
      { _id: 'p1', amount: 10000, status: 'FAILED', failure: {} },
      { _id: 'p2', amount: 20000, status: 'FAILED', failure: {} }
    ],
    recoveryCases: [
      { _id: 'c1', payment: 'p1', status: RECOVERY_CASE_STATUS.DETECTED, recoveredAmount: 0 },
      { _id: 'c2', payment: 'p2', status: RECOVERY_CASE_STATUS.DETECTED, recoveredAmount: 0 }
    ],
    recoveryActions: [
      { recoveryCase: 'c1', type: RECOVERY_ACTION_TYPE.RETRY_PAYMENT, status: RECOVERY_ACTION_STATUS.POLICY_BLOCKED, policyDecision: { decision: 'BLOCKED' }, payment: 'p1' },
      { recoveryCase: 'c2', type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER, status: RECOVERY_ACTION_STATUS.BLOCKED, policyDecision: { decision: 'BLOCKED' }, payment: 'p2' }
    ],
    auditEvents: []
  };

  const m = calculateOverview(data);

  assert.equal(m.blockedActions, 2);
  assert.equal(m.blockedAmount, 30000);
});

test('calculateOverview computes in-recovery amount from active cases', () => {
  const data = {
    payments: [
      { _id: 'p1', amount: 10000, status: 'FAILED', failure: {} },
      { _id: 'p2', amount: 20000, status: 'FAILED', failure: {} },
      { _id: 'p3', amount: 30000, status: 'FAILED', failure: {} }
    ],
    recoveryCases: [
      { _id: 'c1', payment: 'p1', status: RECOVERY_CASE_STATUS.ACTION_PENDING, recoveredAmount: 0 },
      { _id: 'c2', payment: 'p2', status: RECOVERY_CASE_STATUS.ACTION_EXECUTING, recoveredAmount: 0 },
      { _id: 'c3', payment: 'p3', status: RECOVERY_CASE_STATUS.RECOVERED, recoveredAmount: 30000 }
    ],
    recoveryActions: [],
    auditEvents: [
      { recoveryCase: 'c3', type: AUDIT_EVENT_TYPE.RECOVERY_COMPLETED, actor: ACTOR_TYPE.RAZORPAY }
    ]
  };

  const m = calculateOverview(data);

  assert.equal(m.inRecoveryAmount, 30000);
});

test('calculateOverview funnel never fabricates unsupported states', () => {
  const data = {
    payments: [{ _id: 'p1', amount: 10000, status: 'FAILED', failure: {} }],
    recoveryCases: [{ _id: 'c1', payment: 'p1', status: RECOVERY_CASE_STATUS.DETECTED, recoveredAmount: 0 }],
    recoveryActions: [],
    auditEvents: []
  };

  const m = calculateOverview(data);

  assert.equal(m.funnel.detected.count, 1);
  assert.equal(m.funnel.diagnosed.count, 0);
  assert.equal(m.funnel.recommended.count, 0);
  assert.equal(m.funnel.policyAllowed.count, 0);
  assert.equal(m.funnel.executed.count, 0);
  assert.equal(m.funnel.recovered.count, 0);
});

test('calculateOverview handles empty data without errors', () => {
  const m = calculateOverview({});

  assert.equal(m.revenueAtRisk, 0);
  assert.equal(m.recoveryRate, 0);
  assert.equal(m.escalatedCases, 0);
  assert.equal(m.funnel.detected.count, 0);
});

test('calculatePerformance: daily trend uses daily rate, not cumulative', () => {
  const data = {
    payments: [
      { _id: 'p1', amount: 10000, status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { _id: 'p2', amount: 20000, status: 'FAILED', failure: { code: 'insufficient_funds' } }
    ],
    recoveryCases: [
      { _id: 'c1', payment: 'p1', status: 'RECOVERED', recoveredAmount: 10000, createdAt: '2026-09-03T10:00:00Z', resolvedAt: '2026-09-03T10:00:00Z' },
      { _id: 'c2', payment: 'p2', status: 'RECOVERED', recoveredAmount: 20000, createdAt: '2026-09-04T10:00:00Z', resolvedAt: '2026-09-04T10:00:00Z' }
    ],
    recoveryActions: [
      { recoveryCase: 'c1', type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { providerReference: 'ref-1' } },
      { recoveryCase: 'c2', type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { providerReference: 'ref-2' } }
    ],
    auditEvents: [
      { recoveryCase: 'c1', type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY' },
      { recoveryCase: 'c2', type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY' }
    ]
  };

  const result = calculatePerformance(data);

  assert.equal(result.series.length, 2);
  assert.equal(result.series[0].day, '2026-09-03');
  assert.equal(result.series[0].recoveredCount, 1);
  assert.equal(result.series[0].recoveryRate, 1.0);

  assert.equal(result.series[1].day, '2026-09-04');
  assert.equal(result.series[1].recoveredCount, 1);
  assert.equal(result.series[1].recoveryRate, 1.0);

  assert.equal(result.summary.recoveryRate, 1.0);
});

test('calculatePerformance: zero denominator day shows null recovery rate', () => {
  const data = {
    payments: [
      { _id: 'p1', amount: 10000, status: 'FAILED', failure: { code: 'insufficient_funds' } }
    ],
    recoveryCases: [
      { _id: 'c1', payment: 'p1', status: 'RECOVERED', recoveredAmount: 10000, createdAt: '2026-09-03T10:00:00Z', resolvedAt: '2026-09-04T10:00:00Z' }
    ],
    recoveryActions: [
      { recoveryCase: 'c1', type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { providerReference: 'ref-1' } }
    ],
    auditEvents: [
      { recoveryCase: 'c1', type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY' }
    ]
  };

  const result = calculatePerformance(data);

  assert.equal(result.series.length, 2);
  assert.equal(result.series[0].day, '2026-09-03');
  assert.equal(result.series[0].recoveredCount, 0);
  assert.equal(result.series[0].recoveryRate, 0);

  assert.equal(result.series[1].day, '2026-09-04');
  assert.equal(result.series[1].recoveredCount, 1);
  assert.equal(result.series[1].recoveryRate, null);
});

test('calculatePerformance: days are sorted chronologically before rate calculation', () => {
  const data = {
    payments: [
      { _id: 'p1', amount: 10000, status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { _id: 'p2', amount: 20000, status: 'FAILED', failure: { code: 'insufficient_funds' } }
    ],
    recoveryCases: [
      { _id: 'c1', payment: 'p1', status: 'RECOVERED', recoveredAmount: 10000, createdAt: '2026-09-01T10:00:00Z', resolvedAt: '2026-09-02T10:00:00Z' },
      { _id: 'c2', payment: 'p2', status: 'RECOVERED', recoveredAmount: 20000, createdAt: '2026-09-02T10:00:00Z', resolvedAt: '2026-09-01T10:00:00Z' }
    ],
    recoveryActions: [
      { recoveryCase: 'c1', type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { providerReference: 'ref-1' } },
      { recoveryCase: 'c2', type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { providerReference: 'ref-2' } }
    ],
    auditEvents: [
      { recoveryCase: 'c1', type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY' },
      { recoveryCase: 'c2', type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY' }
    ]
  };

  const result = calculatePerformance(data);

  assert.equal(result.series.length, 2);
  assert.equal(result.series[0].day, '2026-09-01');
  assert.equal(result.series[0].recoveredCount, 1);
  assert.equal(result.series[0].recoveryRate, 1.0);

  assert.equal(result.series[1].day, '2026-09-02');
  assert.equal(result.series[1].recoveredCount, 1);
  assert.equal(result.series[1].recoveryRate, 1.0);

  assert.equal(result.summary.recoveryRate, 1.0);
});

test('calculatePerformance: overall summary metrics remain unchanged by daily fix', () => {
  const data = {
    payments: [
      { _id: 'p1', amount: 10000, status: 'FAILED', failure: { code: 'insufficient_funds' } },
      { _id: 'p2', amount: 20000, status: 'FAILED', failure: { code: 'insufficient_funds' } }
    ],
    recoveryCases: [
      { _id: 'c1', payment: 'p1', status: 'RECOVERED', recoveredAmount: 10000, createdAt: '2026-09-03T10:00:00Z', resolvedAt: '2026-09-03T10:00:00Z' },
      { _id: 'c2', payment: 'p2', status: 'DETECTED', recoveredAmount: 0, createdAt: '2026-09-03T10:00:00Z' }
    ],
    recoveryActions: [
      { recoveryCase: 'c1', type: 'CUSTOMER_REMINDER', status: 'EXECUTED', execution: { providerReference: 'ref-1' } }
    ],
    auditEvents: [
      { recoveryCase: 'c1', type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY' }
    ]
  };

  const result = calculatePerformance(data);

  assert.equal(result.summary.totalRecovered, 1);
  assert.equal(result.summary.totalEligible, 1);
  assert.equal(result.summary.recoveryRate, 0.5);
  assert.equal(result.summary.recoveredAmount, 10000);
});
