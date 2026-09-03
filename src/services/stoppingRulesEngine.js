const { RECOVERY_ACTION_TYPE, RECOVERY_CASE_STATUS } = require('../constants/enums');

const STOPPING_DECISION = Object.freeze({
  ALLOW: 'ALLOW',
  BLOCK: 'BLOCK',
  ESCALATE: 'ESCALATE'
});

/**
 * Centralized, deterministic stopping-rule evaluation layer.
 *
 * AI may recommend an action. Policy may allow it. But stopping rules
 * are the final safety gate that decides whether automation should
 * actually proceed, stop, or escalate to human review.
 *
 * The AI can never bypass these rules. Every decision is explainable
 * and auditable.
 *
 * Rules are evaluated in priority order. The most restrictive
 * applicable decision wins:
 *   ESCALATE > BLOCK > ALLOW
 */
function evaluateStoppingRules({ policy, payment, recoveryCase, action, existingActions = [] }) {
  const evaluations = [];

  evaluations.push(evaluateTerminalState(recoveryCase));
  evaluations.push(evaluatePaymentCaptured(payment));
  evaluations.push(evaluateMaxRetries(policy, recoveryCase, action));
  evaluations.push(evaluateContactFatigue(policy, recoveryCase, action));
  evaluations.push(evaluateCooldown(policy, existingActions));
  evaluations.push(evaluateEscalationCooldown(policy, existingActions, action));
  evaluations.push(evaluateAutomationExhausted(policy, recoveryCase));

  const escalations = evaluations.filter((e) => e.decision === STOPPING_DECISION.ESCALATE);
  if (escalations.length > 0) {
    return escalations[0];
  }

  const blocks = evaluations.filter((e) => e.decision === STOPPING_DECISION.BLOCK);
  if (blocks.length > 0) {
    return blocks[0];
  }

  return {
    decision: STOPPING_DECISION.ALLOW,
    rule: 'NONE',
    reason: 'No stopping rules triggered. Automated action is permitted.',
    evidence: {}
  };
}

function evaluateTerminalState(recoveryCase) {
  const terminalStatuses = [RECOVERY_CASE_STATUS.RECOVERED, RECOVERY_CASE_STATUS.CLOSED, RECOVERY_CASE_STATUS.UNRECOVERED];
  if (terminalStatuses.includes(recoveryCase.status)) {
    return {
      decision: STOPPING_DECISION.BLOCK,
      rule: 'TERMINAL_STATE',
      reason: `Recovery case is already ${recoveryCase.status.toLowerCase()}. No further automated action is permitted.`,
      evidence: { caseStatus: recoveryCase.status }
    };
  }
  return { decision: STOPPING_DECISION.ALLOW, rule: 'TERMINAL_STATE', reason: 'Case is not in a terminal state.', evidence: {} };
}

function evaluatePaymentCaptured(payment) {
  if (payment.status === 'CAPTURED') {
    return {
      decision: STOPPING_DECISION.BLOCK,
      rule: 'PAYMENT_CAPTURED',
      reason: 'Payment has already been captured. Recovery is no longer applicable.',
      evidence: { paymentStatus: payment.status }
    };
  }
  return { decision: STOPPING_DECISION.ALLOW, rule: 'PAYMENT_CAPTURED', reason: 'Payment is not captured.', evidence: {} };
}

function evaluateMaxRetries(policy, recoveryCase, action) {
  if (action === RECOVERY_ACTION_TYPE.RETRY_PAYMENT && recoveryCase.retryCount >= policy.maxAutomaticRetries) {
    return {
      decision: STOPPING_DECISION.ESCALATE,
      rule: 'MAX_RETRIES_EXHAUSTED',
      reason: `Maximum automatic retry count (${policy.maxAutomaticRetries}) reached. Automation stops; escalating for human review.`,
      evidence: { retryCount: recoveryCase.retryCount, maxRetries: policy.maxAutomaticRetries }
    };
  }
  return { decision: STOPPING_DECISION.ALLOW, rule: 'MAX_RETRIES', reason: 'Retry limit not reached.', evidence: {} };
}

function evaluateContactFatigue(policy, recoveryCase, action) {
  if (action === RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER && recoveryCase.customerContactAttempts >= policy.maxCustomerContactAttempts) {
    return {
      decision: STOPPING_DECISION.ESCALATE,
      rule: 'CONTACT_FATIGUE',
      reason: `Customer has been contacted ${recoveryCase.customerContactAttempts} time(s) without successful recovery. Automation stops to prevent fatigue; escalating for human review.`,
      evidence: { contactAttempts: recoveryCase.customerContactAttempts, maxContacts: policy.maxCustomerContactAttempts }
    };
  }
  return { decision: STOPPING_DECISION.ALLOW, rule: 'CONTACT_FATIGUE', reason: 'Contact fatigue limit not reached.', evidence: {} };
}

function evaluateCooldown(policy, existingActions) {
  const cooldownMinutes = policy.cooldownMinutes != null ? policy.cooldownMinutes : 0;
  if (cooldownMinutes <= 0 || existingActions.length === 0) {
    return { decision: STOPPING_DECISION.ALLOW, rule: 'COOLDOWN', reason: 'No cooldown configured or no prior actions.', evidence: {} };
  }
  const sorted = [...existingActions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const lastAction = sorted[0];
  const lastActionTime = new Date(lastAction.createdAt).getTime();
  const elapsedMs = Date.now() - lastActionTime;
  const cooldownMs = cooldownMinutes * 60 * 1000;
  if (elapsedMs < cooldownMs) {
    const remainingMs = cooldownMs - elapsedMs;
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return {
      decision: STOPPING_DECISION.BLOCK,
      rule: 'COOLDOWN',
      reason: `Recovery cooldown period (${cooldownMinutes} min) has not elapsed. ${remainingMinutes} minute(s) remaining.`,
      evidence: { lastActionAt: lastAction.createdAt, cooldownMinutes, remainingMinutes }
    };
  }
  return { decision: STOPPING_DECISION.ALLOW, rule: 'COOLDOWN', reason: 'Cooldown period has elapsed.', evidence: {} };
}

function evaluateEscalationCooldown(policy, existingActions, action) {
  if (action !== RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN || !policy.escalationCooldownMinutes || existingActions.length === 0) {
    return { decision: STOPPING_DECISION.ALLOW, rule: 'ESCALATION_COOLDOWN', reason: 'No escalation cooldown is blocking this action.', evidence: {} };
  }
  const lastEscalation = [...existingActions]
    .filter((candidate) => candidate.type === RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  if (!lastEscalation) return { decision: STOPPING_DECISION.ALLOW, rule: 'ESCALATION_COOLDOWN', reason: 'No prior escalation exists.', evidence: {} };
  const elapsedMs = Date.now() - new Date(lastEscalation.createdAt).getTime();
  const cooldownMs = policy.escalationCooldownMinutes * 60 * 1000;
  if (elapsedMs < cooldownMs) {
    const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000);
    return {
      decision: STOPPING_DECISION.BLOCK,
      rule: 'ESCALATION_COOLDOWN',
      reason: `Escalation cooldown period (${policy.escalationCooldownMinutes} min) has not elapsed. ${remainingMinutes} minute(s) remaining.`,
      evidence: { lastEscalationAt: lastEscalation.createdAt, escalationCooldownMinutes: policy.escalationCooldownMinutes, remainingMinutes }
    };
  }
  return { decision: STOPPING_DECISION.ALLOW, rule: 'ESCALATION_COOLDOWN', reason: 'Escalation cooldown period has elapsed.', evidence: {} };
}

function evaluateAutomationExhausted(policy, recoveryCase) {
  const retryExhausted = recoveryCase.retryCount >= policy.maxAutomaticRetries;
  const contactsExhausted = recoveryCase.customerContactAttempts >= policy.maxCustomerContactAttempts;
  if (retryExhausted && contactsExhausted) {
    return {
      decision: STOPPING_DECISION.ESCALATE,
      rule: 'AUTOMATION_EXHAUSTED',
      reason: 'All automated recovery channels (retries and customer contacts) are exhausted. Escalating for human review.',
      evidence: { retryCount: recoveryCase.retryCount, contactAttempts: recoveryCase.customerContactAttempts }
    };
  }
  return { decision: STOPPING_DECISION.ALLOW, rule: 'AUTOMATION_EXHAUSTED', reason: 'Automation channels not fully exhausted.', evidence: {} };
}

module.exports = { evaluateStoppingRules, STOPPING_DECISION };
