/**
 * Evidence-driven repair for original failed payments whose historical status
 * was overwritten to CAPTURED by the pre-fix recovery confirmation.
 *
 * Root cause being repaired: RazorpayWebhookRepository.confirmRecovery (and
 * reconcileConfirmedRecovery) used to run
 *   Payment.findOneAndUpdate({ _id: action.payment }, { $set: { status: 'CAPTURED', ... } })
 * where action.payment is RecoveryCase.payment — the ORIGINAL failed payment.
 *
 * WHY THE FIRST VERSION REPORTED "nothing to repair": it required a
 * Razorpay-authored PAYMENT_FAILED audit event to consider a payment at all.
 * Payments created outside webhook ingestion (e.g. deterministic demo
 * scenarios) carry their failure signal on the Payment document itself
 * (failure.code) and have NO PAYMENT_FAILED audit events, so the known
 * damaged case never became a candidate. Candidate selection now accepts the
 * persisted failure signal OR a failure audit event.
 *
 * A payment is restored to FAILED only when ALL of the following hold:
 *   1. its current status is CAPTURED; AND it carries failure evidence —
 *      either a PAYMENT_FAILED audit event or a persisted failure.code;
 *   2. NO genuine provider capture evidence exists for THIS payment: no
 *      Razorpay-authored PAYMENT_CAPTURED audit event and no processed
 *      payment.captured / payment.authorized webhook referencing it
 *      (a genuine capture always leaves one of these behind);
 *   3. at least one EXECUTED recovery action points AT this payment
 *      (RecoveryAction.payment) and carries a VERIFIED
 *      execution.providerPaymentId that differs from the payment's own
 *      razorpayPaymentId — proving the CAPTURED status came from the
 *      conflation bug, not from this payment actually succeeding.
 *
 * DRY-RUN by default. Pass --apply to write repairs. Only `status` is
 * modified ($set: { status: 'FAILED' }); amount, currency, failure code,
 * provider IDs, recovery amounts, and audit history are never altered, and
 * no payments are created.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('../src/models/Payment');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const WebhookEvent = require('../src/models/WebhookEvent');
const { ACTOR_TYPE, AUDIT_EVENT_TYPE } = require('../src/constants/enums');

/**
 * Pure decision core. `evidence`:
 *   hasFailureEvidence            - PAYMENT_FAILED audit exists OR payment.failure?.code is set
 *   hasGenuineCaptureEvidence     - Razorpay capture audit OR captured/authorized webhook for THIS payment
 *   conflatingProviderPaymentIds  - verified provider payment IDs from EXECUTED actions on this payment
 *                                   whose ID differs from payment.razorpayPaymentId
 */
function isConflationDamagedPayment(payment, { hasFailureEvidence, hasGenuineCaptureEvidence, conflatingProviderPaymentIds = [] }) {
  if (!payment || payment.status !== 'CAPTURED') return false;
  if (!hasFailureEvidence) return false;
  if (hasGenuineCaptureEvidence) return false;
  return conflatingProviderPaymentIds.length > 0;
}

async function collectRepairPlan() {
  // Payments carrying persisted failure evidence: an explicit failure signal
  // on the document itself, or a PAYMENT_FAILED audit event (any actor).
  const failedAuditPayments = await AuditEvent.find({
    type: AUDIT_EVENT_TYPE.PAYMENT_FAILED
  }).distinct('payment');
  const candidates = await Payment.find({
    status: 'CAPTURED',
    $or: [
      { 'failure.code': { $exists: true, $nin: [null, ''] } },
      { _id: { $in: failedAuditPayments.filter(Boolean) } }
    ]
  }).lean();

  const plan = [];
  for (const payment of candidates) {
    // Genuine provider capture evidence for THIS payment id disqualifies it.
    const [captureAudits, captureWebhooks, confirmingActions] = await Promise.all([
      AuditEvent.countDocuments({
        type: AUDIT_EVENT_TYPE.PAYMENT_CAPTURED,
        actor: ACTOR_TYPE.RAZORPAY,
        payment: payment._id
      }),
      WebhookEvent.countDocuments({
        providerEventType: { $in: ['payment.captured', 'payment.authorized'] },
        payment: payment._id
      }),
      RecoveryAction.find({
        payment: payment._id,
        status: 'EXECUTED',
        'execution.providerPaymentId': { $exists: true, $nin: [null, ''] }
      }).select('execution.providerPaymentId').lean()
    ]);

    const ownProviderId = payment.razorpayPaymentId || null;
    const conflatingProviderPaymentIds = [...new Set(confirmingActions
      .map((actionDocument) => actionDocument.execution.providerPaymentId)
      .filter((providerPaymentId) => !ownProviderId || providerPaymentId !== ownProviderId))];

    const evidence = {
      hasFailureEvidence: Boolean(payment.failure?.code) || failedAuditPayments.some((id) => String(id) === String(payment._id)),
      hasGenuineCaptureEvidence: captureAudits > 0 || captureWebhooks > 0,
      conflatingProviderPaymentIds
    };
    if (isConflationDamagedPayment(payment, evidence)) plan.push({ payment, evidence });
  }
  return plan;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    const plan = await collectRepairPlan();
    if (!plan.length) {
      console.log('No conflation-damaged payments found. Nothing to repair.');
      return;
    }

    let repaired = 0;
    for (const { payment, evidence } of plan) {
      console.log(`${apply ? 'REPAIRING' : '[dry-run] would repair'} payment ${payment._id}`);
      console.log(`  provider id       : ${payment.razorpayPaymentId || '(none recorded)'}`);
      console.log(`  current status    : ${payment.status} -> FAILED`);
      console.log(`  failure signal    : ${payment.failure?.code || '(from PAYMENT_FAILED audit)'}`);
      console.log(`  recovery payments : ${evidence.conflatingProviderPaymentIds.join(', ')}`);

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

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { isConflationDamagedPayment };

