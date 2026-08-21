const { AnalyticsRepository } = require('../repositories/analyticsRepository');
const { OPEN_RECOVERY_CASE_STATUSES, PAYMENT_STATUS, RECOVERY_ACTION_STATUS, AUDIT_EVENT_TYPE, ACTOR_TYPE } = require('../constants/enums');
const { classifyFailure } = require('./recoveryIntelligenceService');

class AnalyticsService {
  constructor({ repository = new AnalyticsRepository() } = {}) { this.repository = repository; }

  async overview(merchantId) {
    const data = await this.repository.loadMerchantAnalytics(merchantId);
    return calculateOverview(data);
  }
}

function calculateOverview({ payments = [], recoveryCases = [], recoveryActions = [], auditEvents = [] }) {
  const paymentById = new Map(payments.map((payment) => [String(payment._id), payment]));
  const actionsByCase = groupBy(recoveryActions, (action) => String(action.recoveryCase));
  const evidenceCases = new Set(auditEvents.filter((event) => event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED && event.actor === ACTOR_TYPE.RAZORPAY).map((event) => String(event.recoveryCase)));
  const eligible = recoveryCases.filter((recoveryCase) => OPEN_RECOVERY_CASE_STATUSES.includes(recoveryCase.status) && paymentById.get(String(recoveryCase.payment))?.status === PAYMENT_STATUS.FAILED);
  const recovered = recoveryCases.filter((recoveryCase) => hasRecoveryEvidence(recoveryCase, actionsByCase.get(String(recoveryCase._id)), evidenceCases));
  const revenueAtRisk = sum(eligible.map((recoveryCase) => paymentById.get(String(recoveryCase.payment)).amount));
  const recoveredRevenue = sum(recovered.map((recoveryCase) => recoveryCase.recoveredAmount));
  const attempts = recoveryActions.filter((action) => [RECOVERY_ACTION_STATUS.EXECUTING, RECOVERY_ACTION_STATUS.EXECUTED, RECOVERY_ACTION_STATUS.FAILED].includes(action.status));

  return {
    revenueAtRisk,
    eligibleRecoveryCases: eligible.length,
    recoveryAttempts: attempts.length,
    successfulRecoveries: recovered.length,
    recoveredRevenue,
    recoveryRate: rate(recovered.length, eligible.length),
    recoveryValueRate: rate(recoveredRevenue, revenueAtRisk),
    blockedActions: recoveryActions.filter((action) => [RECOVERY_ACTION_STATUS.POLICY_BLOCKED, RECOVERY_ACTION_STATUS.BLOCKED].includes(action.status)).length,
    failedExecutions: recoveryActions.filter((action) => action.status === RECOVERY_ACTION_STATUS.FAILED).length,
    aiFallbacks: auditEvents.filter((event) => event.type === AUDIT_EVENT_TYPE.AI_FALLBACK_USED).length,
    breakdown: {
      recoveryAction: countBy(recoveryActions, (action) => action.type),
      failureCategory: countBy(recoveryCases, (recoveryCase) => classifyFailure(paymentById.get(String(recoveryCase.payment))?.failure?.code)),
      recoveryStatus: countBy(recoveryCases, (recoveryCase) => recoveryCase.status)
    }
  };
}

function hasRecoveryEvidence(recoveryCase, actions = [], evidenceCases) {
  return recoveryCase.status === 'RECOVERED' && recoveryCase.recoveredAmount > 0 && evidenceCases.has(String(recoveryCase._id)) && actions.some((action) => action.status === RECOVERY_ACTION_STATUS.EXECUTED && action.execution?.providerReference);
}
function sum(values) { return values.reduce((total, value) => total + (Number.isSafeInteger(value) ? value : 0), 0); }
function rate(numerator, denominator) { return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0; }
function groupBy(items, key) { return items.reduce((groups, item) => { const value = key(item); (groups.get(value) || groups.set(value, []).get(value)).push(item); return groups; }, new Map()); }
function countBy(items, key) { return items.reduce((result, item) => { const value = key(item) || 'UNKNOWN'; result[value] = (result[value] || 0) + 1; return result; }, {}); }

module.exports = { AnalyticsService, calculateOverview, hasRecoveryEvidence };
