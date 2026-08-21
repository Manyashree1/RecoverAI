const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAiRecommendation } = require('../src/services/ai/recommendationSchema');

function validRaw(overrides = {}) {
  return {
    action: 'RETRY_PAYMENT',
    confidence: 0.85,
    diagnosis: 'Likely a temporary payment failure.',
    reason: 'Temporary failure with retries remaining.',
    factors: ['FAILURE_CATEGORY:TEMPORARY'],
    requiresHumanReview: false,
    ...overrides
  };
}

test('accepts a well-formed recommendation and copies only the known fields', () => {
  const result = validateAiRecommendation({ ...validRaw(), amount: 999999999, exec: 'rm -rf /' });
  assert.equal(result.valid, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['action', 'confidence', 'diagnosis', 'factors', 'reason', 'requiresHumanReview'].sort());
  assert.equal(result.value.amount, undefined);
  assert.equal(result.value.exec, undefined);
});

test('rejects an action outside the RecoveryAction enum', () => {
  const result = validateAiRecommendation(validRaw({ action: 'ISSUE_REFUND' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('action')));
});

test('rejects a non-numeric or out-of-range confidence', () => {
  assert.equal(validateAiRecommendation(validRaw({ confidence: '0.9' })).valid, false);
  assert.equal(validateAiRecommendation(validRaw({ confidence: 1.5 })).valid, false);
  assert.equal(validateAiRecommendation(validRaw({ confidence: -0.1 })).valid, false);
  assert.equal(validateAiRecommendation(validRaw({ confidence: Number.NaN })).valid, false);
});

test('rejects a missing or empty reason/diagnosis', () => {
  assert.equal(validateAiRecommendation(validRaw({ reason: '' })).valid, false);
  assert.equal(validateAiRecommendation(validRaw({ diagnosis: undefined })).valid, false);
});

test('rejects non-array or non-string factors', () => {
  assert.equal(validateAiRecommendation(validRaw({ factors: 'not-an-array' })).valid, false);
  assert.equal(validateAiRecommendation(validRaw({ factors: [1, 2, 3] })).valid, false);
});

test('rejects a non-boolean requiresHumanReview', () => {
  assert.equal(validateAiRecommendation(validRaw({ requiresHumanReview: 'yes' })).valid, false);
});

test('rejects malformed top-level shapes outright', () => {
  assert.equal(validateAiRecommendation(null).valid, false);
  assert.equal(validateAiRecommendation('a string response').valid, false);
  assert.equal(validateAiRecommendation([1, 2, 3]).valid, false);
});

test('truncates overly long strings instead of rejecting them', () => {
  const result = validateAiRecommendation(validRaw({ reason: 'x'.repeat(2000) }));
  assert.equal(result.valid, true);
  assert.ok(result.value.reason.length <= 801);
});
