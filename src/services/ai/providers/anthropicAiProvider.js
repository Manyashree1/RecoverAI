const { AiProviderError, AI_PROVIDER_FAILURE_REASONS } = require('../aiProviderError');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Thin boundary around the Anthropic Messages API. This is the ONLY file
 * that knows the wire format of a specific LLM provider -- everything else
 * in the AI stage talks to providers through `analyzeRecoveryCase(context)`
 * and never sees an SDK or HTTP detail. Swapping or adding a provider means
 * adding another class with the same method, not touching the orchestrator.
 *
 * Returns the *raw*, unvalidated parsed JSON from the model. Callers must
 * run it through `recommendationSchema.validateAiRecommendation` before
 * trusting anything in it.
 */
class AnthropicAiProvider {
  constructor({ apiKey, model, timeoutMs = 8000, fetchImpl = fetch }) {
    if (!apiKey) throw new AiProviderError('AI_API_KEY is not configured.', AI_PROVIDER_FAILURE_REASONS.NOT_CONFIGURED);
    this.apiKey = apiKey;
    this.model = model || 'claude-sonnet-4-6';
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.name = 'anthropic';
  }

  async analyzeRecoveryCase(context, { systemPrompt } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content: JSON.stringify(context) }]
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new AiProviderError('AI provider request timed out.', AI_PROVIDER_FAILURE_REASONS.TIMEOUT);
      }
      throw new AiProviderError(`AI provider network error: ${error.message}`, AI_PROVIDER_FAILURE_REASONS.NETWORK_ERROR);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new AiProviderError('AI provider rate limit exceeded.', AI_PROVIDER_FAILURE_REASONS.RATE_LIMITED);
    }
    if (!response.ok) {
      throw new AiProviderError(`AI provider returned HTTP ${response.status}.`, AI_PROVIDER_FAILURE_REASONS.PROVIDER_ERROR);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new AiProviderError('AI provider returned a non-JSON response.', AI_PROVIDER_FAILURE_REASONS.INVALID_RESPONSE);
    }

    const text = body?.content?.find((block) => block.type === 'text')?.text;
    if (typeof text !== 'string') {
      throw new AiProviderError('AI provider response did not contain a text block.', AI_PROVIDER_FAILURE_REASONS.INVALID_RESPONSE);
    }

    try {
      return JSON.parse(stripCodeFence(text));
    } catch {
      throw new AiProviderError('AI provider text content was not valid JSON.', AI_PROVIDER_FAILURE_REASONS.INVALID_RESPONSE);
    }
  }
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

module.exports = { AnthropicAiProvider };
