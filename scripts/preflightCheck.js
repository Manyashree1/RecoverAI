const http = require('http');
const { env } = require('../src/config/env');

const CHECKS = [];
let criticalFailed = false;

function log(status, message) {
  const prefix = status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '❌';
  console.log(`${prefix} ${message}`);
  if (status === 'fail') criticalFailed = true;
}

async function checkMongo() {
  try {
    const { connectDatabase } = require('../src/config/database');
    const mongoose = require('mongoose');
    await connectDatabase();
    await mongoose.connection.db.admin().ping();
    log('pass', 'MongoDB connected');
    await mongoose.disconnect();
    CHECKS.push({ name: 'MongoDB', status: 'pass' });
  } catch (error) {
    log('fail', `MongoDB connection failed: ${error.message}`);
    CHECKS.push({ name: 'MongoDB', status: 'fail', error: error.message });
  }
}

async function checkBackend() {
  const port = env.port || 3000;
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          if (body.status === 'ok') {
            log('pass', `Backend reachable on :${port}`);
            CHECKS.push({ name: 'Backend', status: 'pass', port });
            resolve();
          } else {
            throw new Error('Unexpected health status');
          }
        } catch {
          log('fail', `Backend health endpoint returned unexpected response on :${port}`);
          CHECKS.push({ name: 'Backend', status: 'fail', error: 'Unexpected health status' });
          resolve();
        }
      });
    });
    req.on('error', () => {
      log('fail', `Backend not reachable on :${port}`);
      CHECKS.push({ name: 'Backend', status: 'fail', error: `Connection refused on port ${port}` });
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      log('fail', `Backend health check timed out on :${port}`);
      CHECKS.push({ name: 'Backend', status: 'fail', error: 'Timeout' });
      resolve();
    });
  });
}

async function checkWebhookInfo() {
  const port = env.port || 3000;
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health/webhook-info`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          if (body.configured && body.webhookUrl) {
            log('pass', `Webhook endpoint reachable: ${body.webhookUrl}`);
            CHECKS.push({ name: 'WebhookInfo', status: 'pass', url: body.webhookUrl });
          } else if (!body.configured) {
            log('warn', 'Webhook URL not configured (PUBLIC_WEBHOOK_URL not set). Set PUBLIC_WEBHOOK_URL to your tunnel URL for demo use.');
            CHECKS.push({ name: 'WebhookInfo', status: 'warn', error: 'PUBLIC_WEBHOOK_URL not set' });
          } else {
            log('warn', 'Webhook info endpoint returned unexpected shape');
            CHECKS.push({ name: 'WebhookInfo', status: 'warn', error: 'Unexpected response shape' });
          }
          resolve();
        } catch {
          log('fail', 'Webhook info endpoint returned invalid JSON');
          CHECKS.push({ name: 'WebhookInfo', status: 'fail', error: 'Invalid JSON' });
          resolve();
        }
      });
    });
    req.on('error', () => {
      log('fail', `Webhook info endpoint not reachable on :${port}`);
      CHECKS.push({ name: 'WebhookInfo', status: 'fail', error: 'Connection refused' });
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      log('fail', 'Webhook info check timed out');
      CHECKS.push({ name: 'WebhookInfo', status: 'fail', error: 'Timeout' });
      resolve();
    });
  });
}

async function checkDemoMerchant() {
  try {
    const { connectDatabase } = require('../src/config/database');
    const mongoose = require('mongoose');
    const Merchant = require('../src/models/Merchant');
    const RecoveryCase = require('../src/models/RecoveryCase');
    await connectDatabase();
    const merchant = await Merchant.findOne({ slug: 'recoverai-demo' }).lean();
    if (!merchant) {
      log('fail', 'Demo merchant not found');
      CHECKS.push({ name: 'DemoMerchant', status: 'fail', error: 'Not found' });
      await mongoose.disconnect();
      return;
    }
    const merchantId = String(merchant._id);
    const caseCount = await RecoveryCase.countDocuments({ merchant: merchantId }).lean();
    if (caseCount === 21) {
      log('pass', `Demo merchant found with ${caseCount} recovery cases`);
      CHECKS.push({ name: 'DemoMerchant', status: 'pass', caseCount });
    } else if (caseCount === 0) {
      log('warn', `Demo merchant found but has ${caseCount} recovery cases. Run npm run seed:demo to populate demo data.`);
      CHECKS.push({ name: 'DemoMerchant', status: 'warn', caseCount });
    } else {
      log('warn', `Demo merchant found with ${caseCount} recovery cases (expected 21 for standard demo)`);
      CHECKS.push({ name: 'DemoMerchant', status: 'warn', caseCount });
    }
    await mongoose.disconnect();
  } catch (error) {
    log('fail', `Demo merchant check failed: ${error.message}`);
    CHECKS.push({ name: 'DemoMerchant', status: 'fail', error: error.message });
  }
}

async function checkRazorpayConfig() {
  const hasKeyId = Boolean(env.razorpayKeyId);
  const hasKeySecret = Boolean(env.razorpayKeySecret);
  const hasWebhookSecret = Boolean(env.razorpayWebhookSecret);
  const hasAccountId = Boolean(env.razorpayAccountId);

  if (hasKeyId && hasKeySecret && hasWebhookSecret && hasAccountId) {
    log('pass', 'Razorpay configuration appears present (secrets redacted)');
    CHECKS.push({ name: 'RazorpayConfig', status: 'pass' });
  } else {
    const missing = [];
    if (!hasKeyId) missing.push('RAZORPAY_KEY_ID');
    if (!hasKeySecret) missing.push('RAZORPAY_KEY_SECRET');
    if (!hasWebhookSecret) missing.push('RAZORPAY_WEBHOOK_SECRET');
    if (!hasAccountId) missing.push('RAZORPAY_ACCOUNT_ID');
    log('fail', `Razorpay configuration incomplete. Missing: ${missing.join(', ')}`);
    CHECKS.push({ name: 'RazorpayConfig', status: 'fail', missing });
  }
}

async function main() {
  console.log('\nRecoverAI Preflight\n');

  await checkMongo();
  await checkBackend();
  await checkWebhookInfo();
  await checkDemoMerchant();
  checkRazorpayConfig();

  console.log('\n---');

  if (criticalFailed) {
    console.log('Overall: NOT READY FOR DEMO\n');
    process.exitCode = 1;
  } else {
    const hasWarnings = CHECKS.some((c) => c.status === 'warn');
    if (hasWarnings) {
      console.log('Overall: READY WITH WARNINGS\n');
    } else {
      console.log('Overall: READY FOR DEMO\n');
    }
  }

  console.log('Checks:');
  for (const check of CHECKS) {
    const statusLabel = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`  [${statusLabel}] ${check.name}${check.error ? `: ${check.error}` : ''}`);
  }
  console.log('');
}

main().catch((error) => {
  console.error('Preflight failed:', error);
  process.exitCode = 1;
});
