/* READ-ONLY inspection of the demo_limit recovery journey. Performs no writes. */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/recoverai';
  console.log('Connecting to:', uri.replace(/\/\/[^@]*@/, '//***@'));
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const payments = await db.collection('payments').find({}).toArray();
  console.log('\n=== PAYMENTS ===');
  for (const p of payments) {
    console.log(JSON.stringify({
      _id: p._id, razorpayPaymentId: p.razorpayPaymentId, amount: p.amount,
      currency: p.currency, status: p.status, failure: p.failure, merchant: p.merchant
    }));
  }

  const cases = await db.collection('recoverycases').find({}).toArray();
  console.log('\n=== RECOVERY CASES ===');
  for (const c of cases) {
    console.log(JSON.stringify({
      _id: c._id, payment: c.payment, status: c.status, recoveredAmount: c.recoveredAmount,
      retryCount: c.retryCount, customerContactAttempts: c.customerContactAttempts
    }));
  }

  const actions = await db.collection('recoveryactions').find({}).toArray();
  console.log('\n=== RECOVERY ACTIONS ===');
  for (const a of actions) {
    console.log(JSON.stringify({
      _id: a._id, payment: a.payment, recoveryCase: a.recoveryCase, type: a.type,
      status: a.status, execution: a.execution,
      policyDecision: a.policyDecision ? { decision: a.policyDecision.decision } : undefined
    }));
  }

  console.log('\n=== AUDIT EVENT TYPES by payment ===');
  const events = await db.collection('auditevents').find({}, { projection: { type: 1, actor: 1, payment: 1, recoveryCase: 1, recoveryAction: 1, providerEventId: 1, metadata: 1 } }).toArray();
  for (const e of events) {
    console.log(JSON.stringify({ type: e.type, actor: e.actor, payment: e.payment, providerEventId: e.providerEventId, metadata: e.metadata }));
  }

  const webhookEvents = await db.collection('webhookevents').find({}, { projection: { providerEventType: 1, status: 1, payment: 1, processedAt: 1 } }).toArray();
  console.log('\n=== WEBHOOK EVENTS ===');
  for (const w of webhookEvents) console.log(JSON.stringify(w));

  await mongoose.disconnect();
}
main().catch((error) => { console.error('INSPECTION FAILED:', error.message); process.exit(1); });
