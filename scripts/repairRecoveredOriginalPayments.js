/**
 * Evidence-driven repair for original failed payments whose historical status
 * was overwritten to CAPTURED by the pre-fix recovery confirmation.
 *
 * Root cause being repaired: RazorpayWebhookRepository.confirmRecovery (and
 * reconcileConfirmedRecovery) used to run
 *   Payment.findOneAndUpdate({ _id: action.payment }, { $set: { status: 'CAPTURED', ... } })
 * where action.payment is RecoveryCase.payment — the ORIGINAL failed payment.
 * A verified payment_link.paid webhook for the SEPARATE recovery provider
 * payment therefore rewrote the original Payment from FAILED to CAPTURED.
 * The ingestion code no longer does this, but documents already mutated by the
 * deployed version keep the wrong historical status until repaired.
 *
 * A payment is restored to FAILED only when ALL of the following hold:
 *   1. its current status is CAPTURED;
 *   2. a Razorpay-authored PAYMENT_FAILED audit event exists for it
 *      (the historical truth this repair restores);
 *   3. NO Razorpay-authored PAYMENT_CAPTURED audit event exists for it
 *      (a genuine capture always writes one through webhook ingestion);
 *   4. at least one executed recovery action on its case carries an
 *      execution.providerPaymentId that differs from the payment's own
 *      razorpayPaymentId (or the payment has none), proving the CAPTURED
 *      status came from the conflation bug rather than a real capture.
 *
 * DRY-RUN by default. Pass --apply to write repairs. Nothing else on the
 * payment (amount, currency, failure signal) is modified, no payments are
 * created, and no recovery evidence is touched.
 *
 * Usage:
 *   npm run repair:recovered-originals           # dry run, prints the plan
 *   npm run repair:recovered-originals -- --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('../src/models/Payment');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const { ACTOR_TYPE, AUDIT_EVENT_TYPE } = require('../src/constants/enums');

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    // (2) Payments Razorpay itself reported as FAILED at least once.
    const failedEvents = await AuditEvent.find({
      type: AUDIT_EVENT_TYPE.PAYMENT_FAILED,
      actor: ACTOR_TYPE.RAZORPAY
    }).select('payment').lean();
    const candidateIds = [...new Set(failedEvents.map((event) => String(event.payment)).filter(Boolean))];

    // (3) Exclude payments Razorpay also confirmed captured through ingestion.
    const capturedEvents = await AuditEvent.find({
      type: AUDIT_EVENT_TYPE.PAYMENT_CAPTURED,
      actor: ACTOR_TYPE.RAZORPAY,
      payment: { $in: candidateIds }
    }).select('payment').lean();
    const genuinelyCaptured = new Set(capturedEvents.map((event) => String(event.payment)));

    // (1) Currently CAPTURED, with provider-authored failure evidence.
    const candidates = (await Payment.find({ _id: { $in: candidateIds }, status: 'CAPTURED' }).lean())
      .filter((payment) => !genuinelyCaptured.has(String(payment._id)));

    if (!candidates.length) {
      console.log('No conflation-damaged payments found. Nothing to repair.');
      return;
    }

    let repaired = 0;
    for (const payment of candidates) {
      // (4) Proof of conflation: a provider-confirmed recovery action whose
      // provider payment is NOT this payment's own provider payment.
      const confirmingActions = await RecoveryAction.find({
        payment: payment._id,
        status: 'EXECUTED',
        'execution.providerPaymentId': { $exists: true, $nin: [null, ''] }
      }).select('execution.providerPaymentId execution.result').lean();
      const conflating = confirmingActions.filter(
        (action) => !payment.razorpayPaymentId || action.execution.providerPaymentId !== payment.razorpayPaymentId
      );

      if (!conflating.length) {
        console.log(`SKIP ${payment._id}: captured without recovery-conflation evidence; leaving untouched.`);
        continue;
      }

      console.log(`${apply ? 'REPAIRING' : '[dry-run] would repair'} payment ${payment._id}`);
      console.log(`  provider id       : ${payment.razorpayPaymentId || '(none recorded)'}`);
      console.log(`  current status    : ${payment.status} -> FAILED`);
      console.log(`  failure signal    : ${payment.failure?.code || '(not recorded)'}`);
      console.log(`  recovery payments : ${[...new Set(conflating.map((action) => action.execution.providerPaymentId))].join(', ')}`);

      if (!apply) continue;
      await Payment.updateOne(
        { _id: payment._id, status: 'CAPTURED' },
        { $set: { status: 'FAILED' } }
      );
      repaired += 1;
    }

    console.log(apply ? `Done. ${repaired} payment(s) restored to FAILED.` : 'Dry run complete. Re-run with --apply to write repairs.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
