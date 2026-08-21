const REASONS = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UNSUPPORTED_PROVIDER: 'UNSUPPORTED_PROVIDER',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

/** Typed error for any AI provider failure, so callers can classify and audit it without string-matching messages. */
class AiProviderError extends Error {
  constructor(message, reason = REASONS.UNKNOWN_ERROR) {
    super(message);
    this.name = 'AiProviderError';
    this.reason = reason;
  }
}

module.exports = { AiProviderError, AI_PROVIDER_FAILURE_REASONS: REASONS };
