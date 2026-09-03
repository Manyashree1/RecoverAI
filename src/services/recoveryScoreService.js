const { classifyFailure, FAILURE_CATEGORY } = require('./recoveryIntelligenceService');
const { RECOVERY_CASE_STATUS, RECOVERY_ACTION_TYPE, OPEN_RECOVERY_CASE_STATUSES } = require('../constants/enums');

const SCORE_BOUNDS = Object.freeze({ min: 0, max: 100 });
const RAW_SCORE_MAX = 89;

const FAILURE_SCORE = Object.freeze({
  [FAILURE_CATEGORY.TEMPORARY]: 28,
  [FAILURE_CATEGORY.PAYMENT_METHOD_ISSUE]: 17,
  [FAILURE_CATEGORY.UNKNOWN]: 12,
  [FAILURE_CATEGORY.RISK]: 2
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function computeRetryCapacityScore(retryCount, maxRetries) {
  if (!Number.isFinite(maxRetries) || maxRetries <= 0) return { score: 10, factor: 'RETRY_CAPACITY_NEUTRAL' };
  const ratio = retryCount / maxRetries;
  if (ratio < 0.5) return { score: 22, factor: 'RETRY_CAPACITY_HEALTHY' };
  if (ratio < 0.8) return { score: 14, factor: 'RETRY_CAPACITY_REDUCED' };
  if (ratio < 1) return { score: 7, factor: 'RETRY_CAPACITY_LOW' };
  return { score: 0, factor: 'RETRY_CAPACITY_EXHAUSTED' };
}

function computeContactCapacityScore(contactCount, maxContacts) {
  if (!Number.isFinite(maxContacts) || maxContacts <= 0) return { score: 5, factor: 'CONTACT_CAPACITY_NEUTRAL' };
  const ratio = contactCount / maxContacts;
  if (ratio < 0.5) return { score: 12, factor: 'CONTACT_CAPACITY_HEALTHY' };
  if (ratio < 0.8) return { score: 7, factor: 'CONTACT_CAPACITY_REDUCED' };
  if (ratio < 1) return { score: 3, factor: 'CONTACT_CAPACITY_LOW' };
  return { score: 0, factor: 'CONTACT_CAPACITY_EXHAUSTED' };
}

function computePolicyAlignmentScore(policy) {
  if (!policy) return { score: 5, factor: 'POLICY_ALIGNMENT_UNKNOWN' };
  const allowed = policy.allowedActions || [];
  const viableActions = Object.values(RECOVERY_ACTION_TYPE).filter((action) => action !== RECOVERY_ACTION_TYPE.NO_ACTION && action !== RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN);
  const viableAllowed = viableActions.filter((action) => allowed.includes(action));
  if (viableAllowed.length >= 2) return { score: 18, factor: 'POLICY_ALIGNMENT_STRONG' };
  if (viableAllowed.length === 1) return { score: 11, factor: 'POLICY_ALIGNMENT_PARTIAL' };
  return { score: 0, factor: 'POLICY_ALIGNMENT_NONE' };
}

function computeEvidenceQualityScore(recoveryCase, payment) {
  const hasDiagnosis = Boolean(recoveryCase?.diagnosis?.explanation);
  const hasFailureCode = Boolean(payment?.failure?.code);
  if (hasDiagnosis && hasFailureCode) return { score: 9, factor: 'EVIDENCE_QUALITY_HIGH' };
  if (hasFailureCode) return { score: 6, factor: 'EVIDENCE_QUALITY_MEDIUM' };
  if (hasDiagnosis) return { score: 5, factor: 'EVIDENCE_QUALITY_DIAGNOSIS_ONLY' };
  return { score: 2, factor: 'EVIDENCE_QUALITY_LOW' };
}

function classifyScore(score) {
  if (score >= 70) return 'HIGH_RECOVERY_POTENTIAL';
  if (score >= 40) return 'MEDIUM_RECOVERY_POTENTIAL';
  return 'LOW_RECOVERY_POTENTIAL';
}

function computeConfidence(failureCategory, hasDiagnosis, hasFailureCode, policy) {
  if (!failureCategory || failureCategory === FAILURE_CATEGORY.UNKNOWN) return 0.4;
  if (!hasDiagnosis && !hasFailureCode) return 0.45;
  if (hasDiagnosis && hasFailureCode) return 0.9;
  return 0.65;
}

function buildExplanation(components, score) {
  const explanations = [];
  if (components.failure) explanations.push(`${components.failure.factor}: ${components.failure.score} points`);
  if (components.retry) explanations.push(`${components.retry.factor}: ${components.retry.score} points`);
  if (components.contact) explanations.push(`${components.contact.factor}: ${components.contact.score} points`);
  if (components.policy) explanations.push(`${components.policy.factor}: ${components.policy.score} points`);
  if (components.evidence) explanations.push(`${components.evidence.factor}: ${components.evidence.score} points`);
  return {
    summary: `Deterministic recovery score: ${score}/100 — ${classifyScore(score).replace(/_/g, ' ').toLowerCase()}.`,
    components: explanations
  };
}

function computeRecoveryScore(input) {
  const { payment, recoveryCase, policy } = input;

  if (!OPEN_RECOVERY_CASE_STATUSES.includes(recoveryCase?.status)) {
    return {
      score: 0,
      confidence: 1,
      classification: 'NOT_ELIGIBLE',
      factors: [],
      explanation: {
        summary: 'Recovery case is not open for scoring.',
        components: []
      }
    };
  }

  const failureCategory = classifyFailure(payment?.failure?.code);
  const failureComponent = { score: FAILURE_SCORE[failureCategory] || 0, factor: `FAILURE_${failureCategory}` };
  const retryComponent = computeRetryCapacityScore(recoveryCase?.retryCount || 0, policy?.maxAutomaticRetries);
  const contactComponent = computeContactCapacityScore(recoveryCase?.customerContactAttempts || 0, policy?.maxCustomerContactAttempts);
  const policyComponent = computePolicyAlignmentScore(policy);
  const evidenceComponent = computeEvidenceQualityScore(recoveryCase, payment);

  const rawScore = failureComponent.score + retryComponent.score + contactComponent.score + policyComponent.score + evidenceComponent.score;
  const score = clamp(Math.round((rawScore / RAW_SCORE_MAX) * SCORE_BOUNDS.max), SCORE_BOUNDS.min, SCORE_BOUNDS.max);

  const confidence = computeConfidence(failureCategory, Boolean(recoveryCase?.diagnosis?.explanation), Boolean(payment?.failure?.code), policy);
  const factors = [failureComponent.factor, retryComponent.factor, contactComponent.factor, policyComponent.factor, evidenceComponent.factor];

  return {
    score,
    confidence,
    classification: classifyScore(score),
    factors,
    explanation: buildExplanation({ failure: failureComponent, retry: retryComponent, contact: contactComponent, policy: policyComponent, evidence: evidenceComponent }, score)
  };
}

module.exports = { computeRecoveryScore, SCORE_BOUNDS, classifyScore };
