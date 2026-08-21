const { env } = require('../../config/env');
const { AnthropicAiProvider } = require('./providers/anthropicAiProvider');
const { AiProviderError, AI_PROVIDER_FAILURE_REASONS } = require('./aiProviderError');

const SUPPORTED_PROVIDERS = Object.freeze({
  anthropic: AnthropicAiProvider
});

/**
 * Returns null when no AI provider is configured (the application must
 * work with only the deterministic fallback in that case), or a provider
 * instance whose `analyzeRecoveryCase` always throws a classified
 * `AiProviderError` if `AI_PROVIDER` names something we don't support --
 * that failure still flows through the normal audit + fallback path
 * instead of crashing at startup.
 */
function createPrimaryAiProvider({
  provider = env.aiProvider,
  apiKey = env.aiApiKey,
  model = env.aiModel,
  timeoutMs = env.aiTimeoutMs
} = {}) {
  if (!provider || !apiKey) return null;

  const ProviderClass = SUPPORTED_PROVIDERS[provider];
  if (!ProviderClass) {
    return {
      name: provider,
      model,
      // eslint-disable-next-line require-await
      async analyzeRecoveryCase() {
        throw new AiProviderError(`Unsupported AI_PROVIDER "${provider}".`, AI_PROVIDER_FAILURE_REASONS.UNSUPPORTED_PROVIDER);
      }
    };
  }

  return new ProviderClass({ apiKey, model, timeoutMs });
}

module.exports = { createPrimaryAiProvider, SUPPORTED_PROVIDERS };
