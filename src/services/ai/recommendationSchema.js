const { RECOVERY_ACTION_TYPE } = require('../../constants/enums');

const ALLOWED_ACTIONS = new Set(Object.values(RECOVERY_ACTION_TYPE));
const MAX_FACTORS = 10;
const MAX_FACTOR_LENGTH = 100;
const MAX_REASON_LENGTH = 800;
const MAX_DIAGNOSIS_LENGTH = 300;

/**
 * The only place an AI (or fallback) provider's output is trusted. Every
 * field is validated and then copied by hand into a brand-new object --
 * nothing from the raw input is passed through directly, so an unexpected
 * extra field (an invented monetary amount, an executable instruction, an
 * unknown action) can never reach the policy engine or the database.
 */
function validateAiRecommendation(raw) {
  const errors = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Response is not a JSON object.'] };
  }

  if (typeof raw.action !== 'string' || !ALLOWED_ACTIONS.has(raw.action)) {
    errors.push(`"action" must be one of ${[...ALLOWED_ACTIONS].join(', ')}.`);
  }

  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    errors.push('"confidence" must be a finite number between 0 and 1.');
  }

  if (typeof raw.diagnosis !== 'string' || raw.diagnosis.trim().length === 0) {
    errors.push('"diagnosis" must be a non-empty string.');
  }

  if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0) {
    errors.push('"reason" must be a non-empty string.');
  }

  if (!Array.isArray(raw.factors) || raw.factors.some((factor) => typeof factor !== 'string')) {
    errors.push('"factors" must be an array of strings.');
  }

  if (typeof raw.requiresHumanReview !== 'boolean') {
    errors.push('"requiresHumanReview" must be a boolean.');
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      action: raw.action,
      confidence: Number(raw.confidence.toFixed(2)),
      diagnosis: truncate(raw.diagnosis, MAX_DIAGNOSIS_LENGTH),
      reason: truncate(raw.reason, MAX_REASON_LENGTH),
      factors: raw.factors.slice(0, MAX_FACTORS).map((factor) => truncate(factor, MAX_FACTOR_LENGTH)),
      requiresHumanReview: raw.requiresHumanReview
    }
  };
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

module.exports = { validateAiRecommendation };
