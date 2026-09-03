const { AppError } = require('../utils/AppError');
const { RazorpayWebhookRepository } = require('../repositories/razorpayWebhookRepository');
const { MongoTransactionRunner } = require('./mongoTransactionRunner');
const { parseRazorpayPaymentWebhook } = require('./webhookPayloadParser');
const { canTransitionPayment } = require('./paymentStateMachine');
const {
  PAYMENT_STATUS,
  RECOVERY_CASE_STATUS,
  ACTOR_TYPE,
  AUDIT_EVENT_TYPE
} = require('../constants/enums');

class WebhookIngestionService {
  constructor({ repository = new RazorpayWebhookRepository(), transactionRunner = new MongoTransactionRunner() } = {}) {
    this.repository = repository;
    this.transactionRunner = transactionRunner;
  }

  async ingestRazorpayPaymentEvent({ providerEventId, payload }) {
    if (typeof providerEventId !== 'string' || providerEventId.trim().length === 0) {
      throw new AppError('Webhook event identifier is required.', 400);
    }

    const parsed = parseRazorpayPaymentWebhook(payload);
    if (!parsed.supported) return { ignored: true, eventType: parsed.eventType };

    try {
      return await this.transactionRunner.run((session) => this.#ingestInTransaction(providerEventId, parsed, session));
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const existingEvent = await this.repository.findWebhookEvent(providerEventId);
        if (existingEvent) {
            if (parsed.recoveryConfirmation && !parsed.partialPayment) {
            const merchant = await this.repository.findMerchantByAccountId(parsed.providerAccountId);
            const context = merchant
              ? await this.repository.findRecoveryActionByReference({ merchantId: merchant._id, referenceId: parsed.paymentLink.referenceId, paymentLinkId: parsed.paymentLink.id })
              : null;
            if (merchant && context?.action) {
              await this.repository.reconcileConfirmedRecovery({
                merchantId: merchant._id,
                actionId: context.action._id,
                providerPaymentId: parsed.payment.id,
                amount: parsed.paymentLink.amountPaid,
                currency: parsed.paymentLink.currency
              });
            }
          }
          return { duplicate: true, eventType: parsed.eventType };
        }
      }
      throw error;
    }
  }

  async #ingestInTransaction(providerEventId, parsed, session) {
    const merchant = await this.repository.findMerchantByAccountId(parsed.providerAccountId, session);
    if (!merchant) {
      // A 503 causes Razorpay to retry after merchant account configuration is repaired.
      throw new AppError('Webhook account is not configured for a merchant.', 503);
    }

    if (parsed.recoveryConfirmation) {
      return this.#ingestRecoveryConfirmation(providerEventId, parsed, merchant, session);
    }

    const existingPayment = await this.repository.findPaymentByRazorpayPaymentId(parsed.payment.id, session);
    if (existingPayment && String(existingPayment.merchant) !== String(merchant._id)) {
      throw new AppError('Provider payment is associated with a different merchant.', 422);
    }

    const webhookEvent = await this.repository.createWebhookEvent(
      {
        provider: 'RAZORPAY',
        providerEventId,
        providerEventType: parsed.eventType,
        merchant: merchant._id,
        payment: existingPayment?._id
      },
      session
    );

    let payment = existingPayment;
    let statusChanged = false;
    if (!payment) {
      const customer = await this.repository.resolveCustomer(merchant._id, parsed.payment, session);
      payment = await this.repository.createPayment(
        {
          merchant: merchant._id,
          customer: customer._id,
          razorpayPaymentId: parsed.payment.id,
          razorpayOrderId: parsed.payment.orderId,
          amount: parsed.payment.amount,
          currency: parsed.payment.currency,
          status: parsed.targetStatus,
          attemptCount: 1,
          failure: failureDetails(parsed)
        },
        session
      );
      statusChanged = true;
    } else if (canTransitionPayment(payment.status, parsed.targetStatus) && payment.status !== parsed.targetStatus) {
      payment = await this.repository.updatePayment(payment._id, buildPaymentUpdate(parsed), session);
      statusChanged = true;
    }

    let recoveryCase;
    let recoveryCaseCreated = false;
    if (payment.status === PAYMENT_STATUS.FAILED) {
      recoveryCase = await this.repository.findRecoveryCaseByPayment(payment._id, merchant._id, session);
      if (!recoveryCase) {
        recoveryCase = await this.repository.createRecoveryCase(
          { merchant: merchant._id, payment: payment._id, status: RECOVERY_CASE_STATUS.DETECTED },
          session
        );
        recoveryCaseCreated = true;
      }
    } else if (payment.status === PAYMENT_STATUS.CAPTURED) {
      recoveryCase = await this.repository.findRecoveryCaseByPayment(payment._id, merchant._id, session);
      if (recoveryCase && recoveryCase.status !== RECOVERY_CASE_STATUS.CLOSED) {
        recoveryCase = await this.repository.closeRecoveryCase(recoveryCase._id, session);
        await this.repository.createAuditEvent(
          auditEvent({
            merchant,
            payment,
            recoveryCase,
            providerEventId,
            type: AUDIT_EVENT_TYPE.RECOVERY_CASE_CLOSED,
            reason: 'Razorpay reported the payment as captured; no recovery action was executed.'
          }),
          session
        );
      }
    }

    if (statusChanged) {
      await this.repository.createAuditEvent(auditForPaymentEvent({ merchant, payment, recoveryCase, providerEventId, parsed }), session);
    }
    if (recoveryCaseCreated) {
      await this.repository.createAuditEvent(
        auditEvent({
          merchant,
          payment,
          recoveryCase,
          providerEventId,
          type: AUDIT_EVENT_TYPE.RECOVERY_CASE_CREATED,
          reason: 'A failed Razorpay payment is eligible for future recovery analysis.'
        }),
        session
      );
    }

    await this.repository.markWebhookEventProcessed(webhookEvent._id, payment._id, session);
    return { duplicate: false, ignored: false, eventType: parsed.eventType, paymentId: String(payment._id), recoveryCaseId: recoveryCase ? String(recoveryCase._id) : undefined };
  }

  async #ingestRecoveryConfirmation(providerEventId, parsed, merchant, session) {
    const context = await this.repository.findRecoveryActionByReference({
      merchantId: merchant._id,
      referenceId: parsed.paymentLink.referenceId,
      paymentLinkId: parsed.paymentLink.id
    }, session);
    const webhookEvent = await this.repository.createWebhookEvent({
      provider: 'RAZORPAY',
      providerEventId,
      providerEventType: parsed.eventType,
      merchant: merchant._id,
      payment: context?.payment?._id
    }, session);
    if (parsed.partialPayment) {
      if (context?.action && context.recoveryCase && context.payment) {
        await this.repository.createAuditEvent({
          merchant: merchant._id,
          payment: context.payment._id,
          recoveryCase: context.recoveryCase._id,
          recoveryAction: context.action._id,
          providerEventId,
          type: AUDIT_EVENT_TYPE.RECOVERY_PARTIAL_PAYMENT,
          actor: ACTOR_TYPE.RAZORPAY,
          action: context.action.type,
          reason: 'Razorpay reported a partial payment for the RecoverAI Payment Link. Recovery remains pending until the link is fully paid.',
          result: 'PAYMENT_PARTIALLY_CONFIRMED',
          metadata: { provider: 'RAZORPAY', providerPaymentId: parsed.payment.id, providerLinkId: parsed.paymentLink.id, amount: parsed.paymentLink.amountPaid, expectedAmount: parsed.paymentLink.amount, currency: parsed.paymentLink.currency }
        }, session);
      }
      await this.repository.markWebhookEventProcessed(webhookEvent._id, context?.payment?._id, session);
      return { duplicate: false, ignored: !context?.action, partial: true, recovered: false, eventType: parsed.eventType, paymentId: context?.payment ? String(context.payment._id) : undefined, recoveryCaseId: context?.recoveryCase ? String(context.recoveryCase._id) : undefined };
    }
    if (!context?.action || !context.recoveryCase || !context.payment) {
      await this.repository.markWebhookEventProcessed(webhookEvent._id, undefined, session);
      return { duplicate: false, ignored: true, eventType: parsed.eventType };
    }

    const confirmation = await this.repository.confirmRecovery({
      merchantId: merchant._id,
      actionId: context.action._id,
      providerPaymentId: parsed.payment.id,
      amount: parsed.paymentLink.amountPaid,
      currency: parsed.paymentLink.currency
    }, session);
    if (confirmation.confirmed) {
      await this.repository.createAuditEvent({
        merchant: merchant._id,
        payment: context.payment._id,
        recoveryCase: confirmation.recoveryCase._id,
        recoveryAction: confirmation.action._id,
        providerEventId,
        type: AUDIT_EVENT_TYPE.RECOVERY_COMPLETED,
        actor: ACTOR_TYPE.RAZORPAY,
        action: context.action.type,
        reason: 'Razorpay confirmed payment for the RecoverAI Payment Link.',
        result: 'PAYMENT_CONFIRMED',
        metadata: { provider: 'RAZORPAY', providerPaymentId: parsed.payment.id, providerLinkId: parsed.paymentLink.id, amount: parsed.paymentLink.amountPaid, currency: parsed.paymentLink.currency }
      }, session);
    }
    await this.repository.markWebhookEventProcessed(webhookEvent._id, context.payment._id, session);
    return { duplicate: false, ignored: false, recovered: confirmation.confirmed, eventType: parsed.eventType, paymentId: String(context.payment._id), recoveryCaseId: String(context.recoveryCase._id) };
  }
}

function buildPaymentUpdate(parsed) {
  return {
    status: parsed.targetStatus,
    razorpayOrderId: parsed.payment.orderId,
    amount: parsed.payment.amount,
    currency: parsed.payment.currency,
    ...(parsed.targetStatus === PAYMENT_STATUS.FAILED ? { failure: failureDetails(parsed) } : {})
  };
}

function failureDetails(parsed) {
  if (parsed.targetStatus !== PAYMENT_STATUS.FAILED) return undefined;
  return {
    code: parsed.payment.failureCode,
    description: parsed.payment.failureDescription,
    occurredAt: parsed.payment.occurredAt
  };
}

function auditForPaymentEvent({ merchant, payment, recoveryCase, providerEventId, parsed }) {
  const typeByStatus = {
    [PAYMENT_STATUS.FAILED]: AUDIT_EVENT_TYPE.PAYMENT_FAILED,
    [PAYMENT_STATUS.AUTHORIZED]: AUDIT_EVENT_TYPE.PAYMENT_AUTHORIZED,
    [PAYMENT_STATUS.CAPTURED]: AUDIT_EVENT_TYPE.PAYMENT_CAPTURED
  };
  return auditEvent({
    merchant,
    payment,
    recoveryCase,
    providerEventId,
    type: typeByStatus[parsed.targetStatus],
    reason: parsed.targetStatus === PAYMENT_STATUS.FAILED
      ? parsed.payment.failureDescription || parsed.payment.failureCode || 'Razorpay reported a failed payment.'
      : `Razorpay reported the payment as ${parsed.targetStatus.toLowerCase()}.`
  });
}

function auditEvent({ merchant, payment, recoveryCase, providerEventId, type, reason }) {
  return {
    merchant: merchant._id,
    payment: payment._id,
    recoveryCase: recoveryCase?._id,
    providerEventId,
    type,
    actor: ACTOR_TYPE.RAZORPAY,
    reason,
    metadata: { provider: 'RAZORPAY' }
  };
}

function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.code === 11001;
}

module.exports = { WebhookIngestionService };

