const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSourcePath = path.join(__dirname, '..', 'frontend', 'src', 'App.jsx');
const appSource = fs.readFileSync(appSourcePath, 'utf8');

function normalize(source) {
  return source.replace(/\s+/g, ' ').trim();
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const end = source.indexOf(`\nfunction `, start + 1);
  if (end === -1) return source.slice(start);
  return source.slice(start, end);
}

const actionsSource = extractFunction(appSource, 'Actions');
const caseDetailSource = extractFunction(appSource, 'CaseDetail');

// REGRESSION: a successful recovery payment must never make the UI present
// the ORIGINAL failed payment as CAPTURED. The original payment and the
// recovery payment are two distinct Razorpay records; only the recovery
// payment is PAID/CAPTURED and it is represented by execution.providerPaymentId.

test('UI does not label the original failed payment as CAPTURED because recovery succeeded', () => {
  const normalized = normalize(appSource);
  assert.ok(
    !normalized.includes('now captured as part of the recovery journey'),
    'The "original payment is now captured" narrative must not return.'
  );
  assert.ok(!/payment\.status === 'CAPTURED' \?/.test(normalized), 'Original-payment copy must not switch on CAPTURED status.');
  assert.ok(
    normalized.includes('The original payment failed. The recovery outcome below is a separate customer payment, confirmed independently by Razorpay.'),
    'The corrected historical-failure narrative must be present.'
  );
});

test('"Open payment link" navigates using ONLY the persisted execution.shortUrl', () => {
  const normalized = normalize(appSource);
  assert.ok(
    normalized.includes('href={primaryAction.paymentLink.url}') || normalized.includes('href={itemAction.paymentLink.url}'),
    'The anchor must bind href to the persisted paymentLink.url from the API.'
  );
  assert.ok(!normalized.includes("href={`https://"), 'No Razorpay URL may be constructed in JSX.');
  assert.ok(!normalized.includes('rzp.io/'), 'No Razorpay short-URL may be fabricated client-side.');
});

test('Case detail uses originalPayment view for original payment status and failure', () => {
  const normalized = normalize(caseDetailSource);
  assert.ok(
    normalized.includes('originalPayment.status || payment.status'),
    'Original payment status must derive from originalPayment.status, not payment.status.'
  );
  assert.ok(
    normalized.includes('originalPayment.failure?.code || payment.failure?.code'),
    'Original payment failure must derive from originalPayment.failure.'
  );
  assert.ok(
    normalized.includes('originalPayment.detectedAt || payment.createdAt'),
    'Detected timestamp must prefer originalPayment.detectedAt.'
  );
});

test('Case detail shows concise evidence summary and links to full audit trail', () => {
  assert.ok(
    caseDetailSource.includes('item.evidenceSummary'),
    'Case detail must use evidenceSummary from the API.'
  );
  assert.ok(
    caseDetailSource.includes('View full audit trail'),
    'Case detail must provide a link to the full audit trail.'
  );
  assert.ok(
    caseDetailSource.includes('/audit?recoveryCase=${id}'),
    'The audit trail link must filter by the current case ID.'
  );
});

test('Recovery Actions page uses the dedicated recovery-actions API', () => {
  assert.ok(
    actionsSource.includes('api.recoveryActions'),
    'Actions page must call the recovery-actions API endpoint.'
  );
  assert.ok(
    !actionsSource.includes('api.overview'),
    'Actions page must no longer rely on overview breakdown.'
  );
});

test('Recovery Actions page links each action to its recovery case', () => {
  assert.ok(
    actionsSource.includes('/recovery-cases/${itemAction.recoveryCase.id}'),
    'Each action row must link back to its owning recovery case.'
  );
});

test('Recovery Actions page has no execution or retry controls', () => {
  const executePattern = /<button[^>]*Execute[^>]*>/i;
  const retryPattern = /<button[^>]*Retry[^>]*>/i;
  const approvePattern = /<button[^>]*Approve[^>]*>/i;
  const overridePattern = /<button[^>]*Override[^>]*>/i;

  assert.ok(!executePattern.test(actionsSource), 'No Execute button must appear on the Actions page.');
  assert.ok(!retryPattern.test(actionsSource), 'No Retry button must appear on the Actions page.');
  assert.ok(!approvePattern.test(actionsSource), 'No Approve button must appear on the Actions page.');
  assert.ok(!overridePattern.test(actionsSource), 'No Override button must appear on the Actions page.');
});

test('Recovery Actions page renders a table with real ledger columns', () => {
  assert.ok(actionsSource.includes('title="Recovery actions"'), 'Page title must exist.');
  assert.ok(actionsSource.includes('<th>Action</th>'), 'Table must have an Action column.');
  assert.ok(actionsSource.includes('<th>Recovery case</th>'), 'Table must have a Recovery case column.');
  assert.ok(actionsSource.includes('<th>Status</th>'), 'Table must have a Status column.');
  assert.ok(actionsSource.includes('<th>Policy / stopping</th>'), 'Table must have a Policy/stopping column.');
  assert.ok(actionsSource.includes('<th>Execution / outcome</th>'), 'Table must have an Execution column.');
  assert.ok(actionsSource.includes('<th>Timestamp</th>'), 'Table must have a Timestamp column.');
});

test('Recovery Actions page maps over items from the API response', () => {
  assert.ok(
    actionsSource.includes('items.map((itemAction)'),
    'Table must map over API items.'
  );
});

test('Recovery Actions page shows executed evidence without fabricating URLs', () => {
  const normalized = normalize(actionsSource);
  assert.ok(
    normalized.includes('providerPaymentId'),
    'Executed evidence must show provider payment ID when persisted.'
  );
  assert.ok(
    normalized.includes('Open link'),
    'Executed actions must expose a link to the persisted payment link.'
  );
  assert.ok(!normalized.includes("href={`https://"), 'No Razorpay URL may be constructed in JSX.');
  assert.ok(!normalized.includes('rzp.io/'), 'No Razorpay short-URL may be fabricated client-side.');
});

test('Recovery Actions page shows blocked policy reason', () => {
  assert.ok(
    actionsSource.includes('itemAction.policyDecision.reason'),
    'Blocked actions must surface the persisted policy reason.'
  );
});
