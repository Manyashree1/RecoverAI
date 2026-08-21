const { AiProviderError, AI_PROVIDER_FAILURE_REASONS } = require('../../src/services/ai/aiProviderError');

/** A fake AI provider that returns a fixed raw response (valid or intentionally invalid). */
class FakeAiProvider {
  constructor({ name = 'fake-ai', model = 'fake-model-1', response, error } = {}) {
    this.name = name;
    this.model = model;
    this.response = response;
    this.error = error;
    this.calls = [];
  }

  // eslint-disable-next-line require-await
  async analyzeRecoveryCase(context, options) {
    this.calls.push({ context, options });
    if (this.error) throw this.error;
    return this.response;
  }
}

function timeoutProvider() {
  return new FakeAiProvider({ error: new AiProviderError('AI provider request timed out.', AI_PROVIDER_FAILURE_REASONS.TIMEOUT) });
}

function networkErrorProvider() {
  return new FakeAiProvider({ error: new AiProviderError('AI provider network error: fetch failed.', AI_PROVIDER_FAILURE_REASONS.NETWORK_ERROR) });
}

function malformedResponseProvider() {
  return new FakeAiProvider({
    error: new AiProviderError('AI provider text content was not valid JSON.', AI_PROVIDER_FAILURE_REASONS.INVALID_RESPONSE)
  });
}

function validResponseProvider(overrides = {}) {
  return new FakeAiProvider({
    response: {
      action: 'RETRY_PAYMENT',
      confidence: 0.9,
      diagnosis: 'Likely a temporary payment failure.',
      reason: 'The failure code indicates a temporary issue and the merchant policy still allows a retry.',
      factors: ['FAILURE_CATEGORY:TEMPORARY', 'RETRY_ATTEMPTS_AVAILABLE'],
      requiresHumanReview: false,
      ...overrides
    }
  });
}

module.exports = { FakeAiProvider, timeoutProvider, networkErrorProvider, malformedResponseProvider, validResponseProvider };
