const { AnalyticsRepository } = require('../repositories/analyticsRepository');
const { OPEN_RECOVERY_CASE_STATUSES, PAYMENT_STATUS, RECOVERY_ACTION_STATUS, RECOVERY_ACTION_TYPE, RECOVERY_CASE_STATUS, AUDIT_EVENT_TYPE, ACTOR_TYPE } = require('../constants/enums');
const { classifyFailure } = require('./recoveryIntelligenceService');

class AnalyticsService {
  constructor({ repository = new AnalyticsRepository() } = {}) { this.repository = repository; }

  async overview(merchantId) {
    const data = await this.repository.loadMerchantAnalytics(merchantId);
    return calculateOverview(data);
  }

  async outcomes(merchantId) {
    const data = await this.repository.loadMerchantAnalytics(merchantId);
    return calculateOutcomes(data);
  }

  async performance(merchantId) {
    const data = await this.repository.loadMerchantAnalytics(merchantId);
    return calculatePerformance(data);
  }
}

function calculateOverview({ payments = [], recoveryCases = [], recoveryActions = [], auditEvents = [] }) {
  const paymentById = new Map(payments.map((payment) => [String(payment._id), payment]));
  const actionsByCase = groupBy(recoveryActions, (action) => String(action.recoveryCase));
  const evidenceCases = new Set(auditEvents.filter((event) => event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED && event.actor === ACTOR_TYPE.RAZORPAY).map((event) => String(event.recoveryCase)));

  const eligible = recoveryCases.filter((recoveryCase) => OPEN_RECOVERY_CASE_STATUSES.includes(recoveryCase.status) && paymentById.get(String(recoveryCase.payment))?.status === PAYMENT_STATUS.FAILED);
  const recovered = recoveryCases.filter((recoveryCase) => hasRecoveryEvidence(recoveryCase, actionsByCase.get(String(recoveryCase._id)), evidenceCases));

  const revenueAtRisk = sum(eligible.map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0));
  const recoveredAmount = sum(recovered.map((recoveryCase) => recoveryCase.recoveredAmount || 0));
  const recoveredRevenue = recoveredAmount;

  const allFailedPaymentCases = recoveryCases.filter((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.status === PAYMENT_STATUS.FAILED);
  const totalOpportunities = allFailedPaymentCases.length;
  const totalOpportunityValue = sum(allFailedPaymentCases.map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0));

  const attempts = recoveryActions.filter((action) => [RECOVERY_ACTION_STATUS.EXECUTING, RECOVERY_ACTION_STATUS.EXECUTED, RECOVERY_ACTION_STATUS.FAILED].includes(action.status));

  const diagnosedCases = recoveryCases.filter((recoveryCase) => recoveryCase.diagnosis && recoveryCase.diagnosis.explanation);
  const recommendedCases = recoveryCases.filter((recoveryCase) => (actionsByCase.get(String(recoveryCase._id)) || []).length > 0);
  const policyAllowedCases = recoveryCases.filter((recoveryCase) => (actionsByCase.get(String(recoveryCase._id)) || []).some((action) => action.status === RECOVERY_ACTION_STATUS.POLICY_ALLOWED));
  const executedCases = recoveryCases.filter((recoveryCase) => (actionsByCase.get(String(recoveryCase._id)) || []).some((action) => action.status === RECOVERY_ACTION_STATUS.EXECUTED));
  const escalatedCases = recoveryCases.filter((recoveryCase) => (actionsByCase.get(String(recoveryCase._id)) || []).some((action) => action.type === RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN));
  const blockedActions = recoveryActions.filter((action) => [RECOVERY_ACTION_STATUS.POLICY_BLOCKED, RECOVERY_ACTION_STATUS.BLOCKED].includes(action.status));
  const stoppedActions = recoveryActions.filter((action) => action.policyDecision && action.policyDecision.reason && action.policyDecision.reason.includes('stopping'));

  const inRecoveryAmount = sum(recoveryCases.filter((recoveryCase) => [RECOVERY_CASE_STATUS.ACTION_PENDING, RECOVERY_CASE_STATUS.ACTION_EXECUTING].includes(recoveryCase.status)).map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0));
  const blockedAmount = sum(blockedActions.map((action) => paymentById.get(String(action.payment))?.amount || 0));
  const escalatedAmount = sum(escalatedCases.map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0));
  const unrecoveredAmount = sum(recoveryCases.filter((recoveryCase) => ![RECOVERY_CASE_STATUS.RECOVERED, RECOVERY_CASE_STATUS.CLOSED].includes(recoveryCase.status)).map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0)) - recoveredAmount;

  return {
    revenueAtRisk,
    eligibleRecoveryCases: eligible.length,
    recoveryOpportunities: totalOpportunities,
    recoveryOpportunityValue: totalOpportunityValue,
    recoveryAttempts: attempts.length,
    successfulRecoveries: recovered.length,
    recoveredRevenue,
    recoveryRate: rate(recovered.length, totalOpportunities),
    recoveryValueRate: rate(recoveredRevenue, totalOpportunityValue),
    blockedActions: blockedActions.length,
    failedExecutions: recoveryActions.filter((action) => action.status === RECOVERY_ACTION_STATUS.FAILED).length,
    aiFallbacks: auditEvents.filter((event) => event.type === AUDIT_EVENT_TYPE.AI_FALLBACK_USED).length,
    escalatedCases: escalatedCases.length,
    escalatedAmount,
    stoppedActions: stoppedActions.length,
    blockedAmount,
    inRecoveryAmount,
    unrecoveredAmount: unrecoveredAmount > 0 ? unrecoveredAmount : 0,
    funnel: {
      detected: { count: recoveryCases.length, amount: sum(recoveryCases.map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0)) },
      diagnosed: { count: diagnosedCases.length, amount: sum(diagnosedCases.map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0)) },
      recommended: { count: recommendedCases.length, amount: sum(recommendedCases.map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0)) },
      policyAllowed: { count: policyAllowedCases.length, amount: sum(policyAllowedCases.map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0)) },
      executed: { count: executedCases.length, amount: sum(executedCases.map((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.amount || 0)) },
      recovered: { count: recovered.length, amount: recoveredAmount }
    },
    breakdown: {
      recoveryAction: countBy(recoveryActions, (action) => action.type),
      failureCategory: countBy(recoveryCases, (recoveryCase) => classifyFailure(paymentById.get(String(recoveryCase.payment))?.failure?.code)),
      recoveryStatus: countBy(recoveryCases, (recoveryCase) => recoveryCase.status)
    }
  };
}

function calculateOutcomes({ payments = [], recoveryCases = [], recoveryActions = [], auditEvents = [] }) {
  const paymentById = new Map(payments.map((payment) => [String(payment._id), payment]));
  const recoveredAmountByCaseId = new Map(recoveryCases.filter((recoveryCase) => recoveryCase.recoveredAmount > 0).map((recoveryCase) => [String(recoveryCase._id), recoveryCase.recoveredAmount]));
  const evidenceCases = new Set(auditEvents.filter((event) => event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED && event.actor === ACTOR_TYPE.RAZORPAY).map((event) => String(event.recoveryCase)));
  const actionsByCase = groupBy(recoveryActions, (action) => String(action.recoveryCase));

  const recoveredCases = new Set(
    recoveryCases
      .filter((recoveryCase) => hasRecoveryEvidence(recoveryCase, actionsByCase.get(String(recoveryCase._id)), evidenceCases))
      .map((recoveryCase) => String(recoveryCase._id))
  );

  const recoveredActionIds = new Set(
    auditEvents
      .filter((event) => event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED && event.actor === ACTOR_TYPE.RAZORPAY && event.recoveryAction)
      .map((event) => String(event.recoveryAction))
  );

  const outcomes = {};
  for (const actionType of Object.values(RECOVERY_ACTION_TYPE)) {
    if (actionType === RECOVERY_ACTION_TYPE.NO_ACTION) continue;
    const typeActions = recoveryActions.filter((action) => action.type === actionType);
    const recommended = typeActions.length;
    const executed = typeActions.filter((action) => action.status === RECOVERY_ACTION_STATUS.EXECUTED).length;
    const recovered = typeActions.filter((action) => recoveredActionIds.has(String(action._id))).length;
    const recoveredAmountForAction = sum(typeActions.filter((action) => recoveredActionIds.has(String(action._id))).map((action) => recoveredAmountByCaseId.get(String(action.recoveryCase)) || 0));
    outcomes[actionType] = {
      recommended,
      executed,
      recovered,
      recoveryRate: rate(recovered, recommended),
      averageRecoveredAmount: recovered > 0 ? recoveredAmountForAction / recovered : 0
    };
  }

  return { outcomes };
}

function calculatePerformance({ payments = [], recoveryCases = [], recoveryActions = [], auditEvents = [] }) {
  const evidenceCases = new Set(auditEvents.filter((event) => event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED && event.actor === ACTOR_TYPE.RAZORPAY).map((event) => String(event.recoveryCase)));
  const actionsByCase = groupBy(recoveryActions, (action) => String(action.recoveryCase));
  const paymentById = new Map(payments.map((payment) => [String(payment._id), payment]));

  const recoveredCases = recoveryCases.filter((recoveryCase) => hasRecoveryEvidence(recoveryCase, actionsByCase.get(String(recoveryCase._id)), evidenceCases));
  const eligibleCases = recoveryCases.filter((recoveryCase) => OPEN_RECOVERY_CASE_STATUSES.includes(recoveryCase.status) && paymentById.get(String(recoveryCase.payment))?.status === PAYMENT_STATUS.FAILED);
  const totalOpportunities = recoveryCases.filter((recoveryCase) => paymentById.get(String(recoveryCase.payment))?.status === PAYMENT_STATUS.FAILED).length;

  const daily = {};
  for (const recoveryCase of recoveredCases) {
    const day = dayKey(recoveryCase.resolvedAt || recoveryCase.createdAt);
    const amount = recoveryCase.recoveredAmount || 0;
    if (!daily[day]) daily[day] = { recoveredCount: 0, recoveredAmount: 0, eligibleCount: 0, opportunityCount: 0 };
    daily[day].recoveredCount += 1;
    daily[day].recoveredAmount += amount;
  }
  for (const recoveryCase of recoveryCases) {
    const day = dayKey(recoveryCase.createdAt);
    if (!daily[day]) daily[day] = { recoveredCount: 0, recoveredAmount: 0, eligibleCount: 0, opportunityCount: 0 };
    if (paymentById.get(String(recoveryCase.payment))?.status === PAYMENT_STATUS.FAILED) {
      daily[day].opportunityCount += 1;
      if (OPEN_RECOVERY_CASE_STATUSES.includes(recoveryCase.status)) {
        daily[day].eligibleCount += 1;
      }
    }
  }

  let cumulativeRecovered = 0;
  let cumulativeOpportunities = 0;
  const series = Object.entries(daily)
    .map(([day, values]) => {
      cumulativeRecovered += values.recoveredCount;
      cumulativeOpportunities += values.opportunityCount;
      return {
        day,
        eligibleCount: values.eligibleCount,
        recoveredCount: values.recoveredCount,
        recoveredAmount: values.recoveredAmount,
        recoveryRate: rate(cumulativeRecovered, cumulativeOpportunities)
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day));

  const totalRecovered = recoveredCases.length;
  const totalRecoveredAmount = sum(recoveredCases.map((recoveryCase) => recoveryCase.recoveredAmount));
  const avgTimeToRecovery = recoveredCases.length > 0
    ? recoveredCases.reduce((total, recoveryCase) => {
        const created = new Date(recoveryCase.createdAt).getTime();
        const resolved = new Date(recoveryCase.resolvedAt || recoveryCase.createdAt).getTime();
        return total + Math.max(0, resolved - created);
      }, 0) / recoveredCases.length
    : 0;

  return {
    summary: {
      totalEligible: eligibleCases.length,
      totalRecovered,
      recoveryRate: rate(totalRecovered, totalOpportunities),
      recoveredAmount: totalRecoveredAmount,
      averageRecoveredAmount: totalRecovered > 0 ? totalRecoveredAmount / totalRecovered : 0,
      averageTimeToRecoveryMs: avgTimeToRecovery
    },
    series
  };
}

function dayKey(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hasRecoveryEvidence(recoveryCase, actions = [], evidenceCases) {
  return recoveryCase.status === 'RECOVERED' && recoveryCase.recoveredAmount > 0 && evidenceCases.has(String(recoveryCase._id)) && actions.some((action) => action.status === RECOVERY_ACTION_STATUS.EXECUTED && action.execution?.providerReference);
}
function sum(values) { return values.reduce((total, value) => total + (Number.isSafeInteger(value) ? value : 0), 0); }
function rate(numerator, denominator) { return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0; }
function groupBy(items, key) { return items.reduce((groups, item) => { const value = key(item); (groups.get(value) || groups.set(value, []).get(value)).push(item); return groups; }, new Map()); }
function countBy(items, key) { return items.reduce((result, item) => { const value = key(item) || 'UNKNOWN'; result[value] = (result[value] || 0) + 1; return result; }, {}); }

module.exports = { AnalyticsService, calculateOverview, calculateOutcomes, calculatePerformance, hasRecoveryEvidence };
