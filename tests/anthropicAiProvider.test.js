const test = require('node:test');
const assert = require('node:assert/strict');
const { AnthropicAiProvider } = require('../src/services/ai/providers/anthropicAiProvider');

function fakeFetch({ status = 200, jsonBody, throwError, aborts = false } = {}) {
  return async (url, options) => {
    if (aborts) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
    if (throwError) throw throwError;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonBody
    };
  };
}

test('sends the system prompt, model, and context as the Anthropic Messages request body', async () => {
  let capturedBody;
  let capturedHeaders;
  const provider = new AnthropicAiProvider({
    apiKey: 'sk-test-key',
    model: 'claude-test-model',
    fetchImpl: async (url, options) => {
      capturedBody = JSON.parse(options.body);
      capturedHeaders = options.headers;
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"action":"NO_ACTION"}' }] }) };
    }
  });

  await provider.analyzeRecoveryCase({ payment: { amount: 100 } }, { systemPrompt: 'be a good recovery agent' });

  assert.equal(capturedBody.model, 'claude-test-model');
  assert.equal(capturedBody.system, 'be a good recovery agent');
  assert.equal(capturedHeaders['x-api-key'], 'sk-test-key');
  assert.deepEqual(JSON.parse(capturedBody.messages[0].content), { payment: { amount: 100 } });
});

test('parses JSON out of a fenced code block if the model wraps its response', async () => {
  const provider = new AnthropicAiProvider({
    apiKey: 'sk-test-key',
    fetchImpl: fakeFetch({ jsonBody: { content: [{ type: 'text', text: '```json\n{"action":"NO_ACTION","confidence":0.5}\n```' }] } })
  });

  const raw = await provider.analyzeRecoveryCase({}, {});
  assert.deepEqual(raw, { action: 'NO_ACTION', confidence: 0.5 });
});

test('classifies a non-2xx response as a PROVIDER_ERROR', async () => {
  const provider = new AnthropicAiProvider({ apiKey: 'sk-test-key', fetchImpl: fakeFetch({ status: 500, jsonBody: {} }) });
  await assert.rejects(provider.analyzeRecoveryCase({}, {}), (error) => error.reason === 'PROVIDER_ERROR');
});

test('classifies a 429 response as RATE_LIMITED', async () => {
  const provider = new AnthropicAiProvider({ apiKey: 'sk-test-key', fetchImpl: fakeFetch({ status: 429, jsonBody: {} }) });
  await assert.rejects(provider.analyzeRecoveryCase({}, {}), (error) => error.reason === 'RATE_LIMITED');
});

test('classifies unparsable text content as INVALID_RESPONSE', async () => {
  const provider = new AnthropicAiProvider({
    apiKey: 'sk-test-key',
    fetchImpl: fakeFetch({ jsonBody: { content: [{ type: 'text', text: 'not valid json at all' }] } })
  });
  await assert.rejects(provider.analyzeRecoveryCase({}, {}), (error) => error.reason === 'INVALID_RESPONSE');
});

test('classifies a response with no text block as INVALID_RESPONSE', async () => {
  const provider = new AnthropicAiProvider({ apiKey: 'sk-test-key', fetchImpl: fakeFetch({ jsonBody: { content: [] } }) });
  await assert.rejects(provider.analyzeRecoveryCase({}, {}), (error) => error.reason === 'INVALID_RESPONSE');
});

test('a network failure is classified as NETWORK_ERROR', async () => {
  const provider = new AnthropicAiProvider({ apiKey: 'sk-test-key', fetchImpl: fakeFetch({ throwError: new Error('fetch failed') }) });
  await assert.rejects(provider.analyzeRecoveryCase({}, {}), (error) => error.reason === 'NETWORK_ERROR');
});

test('an aborted request (timeout) is classified as TIMEOUT', async () => {
  const provider = new AnthropicAiProvider({ apiKey: 'sk-test-key', timeoutMs: 10, fetchImpl: fakeFetch({ aborts: true }) });
  await assert.rejects(provider.analyzeRecoveryCase({}, {}), (error) => error.reason === 'TIMEOUT');
});

test('throws NOT_CONFIGURED at construction time when no API key is supplied', () => {
  assert.throws(() => new AnthropicAiProvider({ apiKey: undefined }), (error) => error.reason === 'NOT_CONFIGURED');
});
