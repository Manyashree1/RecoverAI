const test = require('node:test');
const assert = require('node:assert/strict');
const { DEMO_SCENARIOS } = require('../scripts/seedDemoData');

test('demo seed scenarios use stable unique selectors for repeatable upserts', () => {
  const firstRunKeys = DEMO_SCENARIOS.map((scenario) => `demo:${scenario.id}`);
  const secondRunKeys = DEMO_SCENARIOS.map((scenario) => `demo:${scenario.id}`);

  assert.deepEqual(firstRunKeys, secondRunKeys);
  assert.equal(new Set(firstRunKeys).size, DEMO_SCENARIOS.length);
  assert.deepEqual(DEMO_SCENARIOS.map((scenario) => scenario.id), ['temporary', 'blocked', 'limit', 'failed']);
});