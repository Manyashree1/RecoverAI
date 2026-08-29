const {
  RECOVERY_ACTION_TYPE,
  POLICY_DECISION
} = require('../constants/enums');
const { evaluateStoppingRules, STOPPING_DECISION } = require('./stoppingRulesEngine');

/**
 * Pure, deterministic gate for a recommendation. It deliberately does not call
 * an LLM or Razorpay, so every result can be tested and audited before execution.
 *
 * Evaluation order:
 *   1. Stopping rules (safety/fatigue/cooldown/terminal-state) — can ESCALATE
 *   2. Policy rules (merchant-configured guardrails) — ALLOWED or BLOCKED
 *
 * The AI can never bypass these checks. Every decision is explainable.
 */
function evaluateRecoveryAction({ policy, payment, recoveryCase, recommendation, existingActions = [] }) {
  const action = recommendation.type;
  const confidence = recommendation.confidence;

  const stoppingResult = evaluateStoppingRules({ policy, payment, recoveryCase, action, existingActions });
  if (stoppingResult.decision === STOPPING_DECISION.ESCALATE) {
    return {
      decision: POLICY_DECISION.BLOCKED,
      allowed: false,
      escalate: true,
      reason: stoppingResult.reason,
      stoppingRule: stoppingResult.rule,
      stoppingEvidence: stoppingResult.evidence
    };
  }
  if (stoppingResult.decision === STOPPING_DECISION.BLOCK) {
    return {
      decision: POLICY_DECISION.BLOCKED,
      allowed: false,
      escalate: false,
      reason: stoppingResult.reason,
      stoppingRule: stoppingResult.rule,
      stoppingEvidence: stoppingResult.evidence
    };
  }

  if (!policy.allowedActions.includes(action)) {
    return blocked('The merchant policy does not allow this recovery action.');
  }

  if (confidence < policy.minimumRecoveryConfidence) {
    return blocked('The recommendation confidence is below the merchant minimum.');
  }

  if (payment.amount > policy.maxTransactionAmount) {
    return blocked('The payment amount exceeds the automatic recovery limit.');
  }

  return {
    decision: POLICY_DECISION.ALLOWED,
    allowed: true,
    escalate: false,
    reason: 'The recommendation satisfies the merchant recovery policy.'
  };
}

function blocked(reason) {
  return { decision: POLICY_DECISION.BLOCKED, allowed: false, escalate: false, reason };
}

module.exports = { evaluateRecoveryAction };

