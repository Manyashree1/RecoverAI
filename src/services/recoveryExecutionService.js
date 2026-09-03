const { AppError } = require('../utils/AppError');
const { randomUUID } = require('node:crypto');
const { RecoveryExecutionRepository } = require('../repositories/recoveryExecutionRepository');
const { MongoTransactionRunner } = require('./mongoTransactionRunner');
const { RazorpayTestClient } = require('./razorpay/razorpayTestClient');
const { env } = require('../config/env');
const { evaluateRecoveryAction } = require('./policyEngine');
const { canTransitionAction } = require('./recoveryExecutionStateMachine');
const { RECOVERY_ACTION_TYPE, RECOVERY_ACTION_STATUS, PAYMENT_STATUS, RECOVERY_CASE_STATUS, ACTOR_TYPE, AUDIT_EVENT_TYPE } = require('../constants/enums');

class RecoveryExecutionService {
  constructor({ repository = new RecoveryExecutionRepository(), transactionRunner = new MongoTransactionRunner(), razorpayClient = new RazorpayTestClient({ keyId: env.razorpayKeyId, keySecret: env.razorpayKeySecret }) } = {}) {
    this.repository = repository;
    this.transactionRunner = transactionRunner;
    this.razorpayClient = razorpayClient;
  }

  async reconcileAlreadyPaidLink({ merchantId, paymentLinkId }) {
    const providerResult = await this.razorpayClient.fetchPaymentLink({ paymentLinkId });
    if (!providerResult || providerResult.status !== 'paid') {
      return { outcome: 'PENDING', paymentLink: providerResult || { id: paymentLinkId, status: 'created' } };
    }

    const context = await this.repository.findActionContextByPaymentLink({ merchantId, referenceId: providerResult.referenceId, paymentLinkId: providerResult.id });
    if (!context || !context.action || !context.recoveryCase || !context.payment) {
      return { outcome: 'IGNORED', paymentLink: providerResult };
    }

    const amount = providerResult.amountPaid || providerResult.amount || context.payment.amount;
    if (typeof amount !== 'number' || amount <= 0 || amount > context.payment.amount * 10) {
      return { outcome: 'REJECTED', reason: 'Payment link amount is invalid for this recovery action.', paymentLink: providerResult };
    }
    if (!providerResult.providerPaymentId) {
      return { outcome: 'REJECTED', reason: 'Razorpay confirmed the link as paid but did not return a provider payment ID.', paymentLink: providerResult };
    }

    const confirmation = await this.transactionRunner.run((session) => this.#confirmAndAuditAlreadyPaidLink({
      merchantId,
      action: context.action,
      payment: context.payment,
      recoveryCase: context.recoveryCase,
      providerPaymentId: providerResult.providerPaymentId,
      amount,
      currency: providerResult.currency || context.payment.currency,
      providerLinkId: providerResult.id
    }, session));

    if (!confirmation.confirmed) {
      return { outcome: 'IGNORED', paymentLink: providerResult };
    }

    return { outcome: 'RECOVERED', action: publicAction(confirmation.action), paymentLink: { id: providerResult.id, providerPaymentId: providerResult.providerPaymentId, status: providerResult.status, amountPaid: amount, currency: confirmation.currency } };
  }

  async #confirmAndAuditAlreadyPaidLink({ merchantId, action, payment, recoveryCase, providerPaymentId, providerLinkId, amount, currency }, session) {
    const confirmation = await this.repository.confirmRecovery({ merchantId, actionId: action._id, providerPaymentId, amount, currency }, session);
    if (!confirmation.confirmed) return confirmation;
    await this.repository.createAuditEvent(audit({
      merchantId,
      action: confirmation.action,
      payment,
      recoveryCase: confirmation.recoveryCase,
      type: AUDIT_EVENT_TYPE.RECOVERY_COMPLETED,
      reason: 'Razorpay confirmed payment for an already-paid RecoverAI Payment Link.',
      result: 'PAYMENT_CONFIRMED',
      metadata: { provider: 'RAZORPAY', providerPaymentId, providerLinkId, amount, currency }
    }), session);
    return confirmation;
  }

  async execute({ merchantId, actionId }) {
    const reserved = await this.transactionRunner.run((session) => this.#reserve(merchantId, actionId, session));
    if (reserved.outcome !== 'RESERVED') return reserved;

    try {
      const providerResult = await this.razorpayClient.createRecoveryPaymentLink(reserved.providerRequest);
      return await this.transactionRunner.run((session) => this.#complete(merchantId, actionId, reserved, providerResult, session));
    } catch (error) {
      return this.transactionRunner.run((session) => this.#fail(merchantId, actionId, reserved, error, session));
    }
  }

  async #reserve(merchantId, actionId, session) {
    const context = await this.repository.findActionContext(merchantId, actionId, session);
    if (!context || !context.payment || !context.recoveryCase) throw new AppError('Recovery action not found.', 404);
    const { action, payment, recoveryCase, customer } = context;
    if (action.status === RECOVERY_ACTION_STATUS.EXECUTED || action.status === RECOVERY_ACTION_STATUS.FAILED) return existing(action);
    if (action.status === RECOVERY_ACTION_STATUS.EXECUTING) return { outcome: 'IN_PROGRESS', action: publicAction(action) };

    const policy = await this.repository.findOrCreatePolicy(merchantId, session);
    const reason = executionBlockReason({ action, payment, recoveryCase, customer, policy });
    if (reason) {
      const blocked = await this.repository.blockAction({ merchantId, actionId, reason }, session) || action;
      await this.repository.createAuditEvent(audit({ merchantId, action: blocked, payment, recoveryCase, type: AUDIT_EVENT_TYPE.ACTION_EXECUTION_BLOCKED, reason, result: 'BLOCKED' }), session);
      return { outcome: 'BLOCKED', reason, action: publicAction(blocked) };
    }

    if (!canTransitionAction(action.status, RECOVERY_ACTION_STATUS.EXECUTING)) {
      return { outcome: 'BLOCKED', reason: 'Recovery action cannot transition to execution.', action: publicAction(action) };
    }
    const executionKey = `payment-link:${action._id}`;
    const claimed = await this.repository.claimExecution({ merchantId, actionId, executionKey }, session);
    if (!claimed) {
      const latest = await this.repository.findActionContext(merchantId, actionId, session);
      return latest?.action?.status === RECOVERY_ACTION_STATUS.EXECUTED || latest?.action?.status === RECOVERY_ACTION_STATUS.FAILED
        ? existing(latest.action)
        : { outcome: 'IN_PROGRESS', action: publicAction(latest?.action || action) };
    }
    await this.repository.createAuditEvent(audit({ merchantId, action: claimed, payment, recoveryCase, type: AUDIT_EVENT_TYPE.ACTION_EXECUTION_STARTED, reason: 'Policy revalidated; requesting a Razorpay TEST payment link.', result: 'EXECUTING' }), session);
    return { outcome: 'RESERVED', executionKey, providerRequest: { amount: payment.amount, currency: payment.currency, referenceId: paymentLinkReference(action._id), customer: { name: customer.name, email: customer.email, contact: customer.phone } } };
  }

  async #complete(merchantId, actionId, reserved, providerResult, session) {
    const context = await this.repository.findActionContext(merchantId, actionId, session);
    const action = await this.repository.markExecuted({ merchantId, actionId, executionKey: reserved.executionKey, providerReference: providerResult.providerReference, shortUrl: providerResult.shortUrl, status: providerResult.status }, session);
    if (!action) return { outcome: 'IN_PROGRESS' };
    const recoveryCase = await this.repository.updateCaseAfterPaymentLink(context.recoveryCase._id, session);
    await this.repository.createAuditEvent(audit({ merchantId, action, payment: context.payment, recoveryCase, type: AUDIT_EVENT_TYPE.ACTION_EXECUTION_COMPLETED, reason: 'Razorpay TEST payment link created. Payment remains unrecovered until provider evidence arrives.', result: 'PAYMENT_LINK_CREATED', metadata: { provider: 'RAZORPAY_TEST', providerReference: providerResult.providerReference, shortUrl: providerResult.shortUrl } }), session);
    return { outcome: 'EXECUTED', action: publicAction(action), paymentLink: { id: providerResult.providerReference, shortUrl: providerResult.shortUrl, status: providerResult.status } };
  }

  async #fail(merchantId, actionId, reserved, error, session) {
    const context = await this.repository.findActionContext(merchantId, actionId, session);
    const message = error?.statusCode === 503 ? 'Razorpay TEST MODE is not configured.' : error?.statusCode === 504 ? 'Razorpay request timed out; execution is not retried automatically.' : 'Razorpay payment-link creation failed.';
    const action = await this.repository.markFailed({ merchantId, actionId, executionKey: reserved.executionKey, error: message }, session);
    if (action && context) await this.repository.createAuditEvent(audit({ merchantId, action, payment: context.payment, recoveryCase: context.recoveryCase, type: AUDIT_EVENT_TYPE.ACTION_EXECUTION_FAILED, reason: message, result: 'FAILED', error: 'RAZORPAY_PROVIDER_FAILURE' }), session);
    return { outcome: 'FAILED', action: publicAction(action), reason: message };
  }
}

function executionBlockReason({ action, payment, recoveryCase, customer, policy }) {
  if (action.status !== RECOVERY_ACTION_STATUS.POLICY_ALLOWED) return 'Recovery action is not policy-allowed.';
  if (payment.status === PAYMENT_STATUS.CAPTURED) return 'Payment is already captured.';
  if ([RECOVERY_CASE_STATUS.RECOVERED, RECOVERY_CASE_STATUS.CLOSED].includes(recoveryCase.status)) return 'Recovery case is already closed or recovered.';
  const recheck = evaluateRecoveryAction({ policy, payment, recoveryCase, recommendation: { type: action.type, confidence: action.recommendation.confidence } });
  if (!recheck.allowed) return recheck.reason;
  if (action.type !== RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER) return `Action ${action.type} is unsupported by the Razorpay TEST execution adapter.`;
  if (!customer?.email && !customer?.phone) return 'Customer contact details are required for a payment-link reminder.';
  return null;
}

function paymentLinkReference(actionId) { return `ra_${String(actionId)}`.slice(0, 40); }
function existing(action) { return { outcome: 'DUPLICATE', action: publicAction(action) }; }
function publicAction(action) {
  if (!action) return undefined;
  const execution = action.execution || {};
  return {
    id: String(action._id),
    type: action.type,
    status: action.status,
    execution: {
      provider: execution.provider,
      providerReference: execution.providerReference,
      result: execution.result,
      error: execution.error,
      executedAt: execution.executedAt
    }
  };
}
function audit({ merchantId, action, payment, recoveryCase, type, reason, result, error, metadata }) { return { merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, recoveryAction: action._id, providerEventId: `recoverai:execution:${action._id}:${type}:${randomUUID()}`, type, actor: ACTOR_TYPE.SYSTEM, action: action.type, reason, result, error, metadata }; }

module.exports = { RecoveryExecutionService };
