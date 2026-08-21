const RecoveryAction = require('../models/RecoveryAction');
const RecoveryCase = require('../models/RecoveryCase');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const RecoveryPolicy = require('../models/RecoveryPolicy');
const AuditEvent = require('../models/AuditEvent');

class RecoveryExecutionRepository {
  async findActionContext(merchantId, actionId, session) {
    const action = await RecoveryAction.findOne({ _id: actionId, merchant: merchantId }).session(session);
    if (!action) return null;
    const recoveryCase = await RecoveryCase.findOne({ _id: action.recoveryCase, merchant: merchantId }).session(session);
    const payment = await Payment.findOne({ _id: action.payment, merchant: merchantId }).session(session);
    const customer = payment ? await Customer.findOne({ _id: payment.customer, merchant: merchantId }).session(session) : null;
    return { action, recoveryCase, payment, customer };
  }

  async findOrCreatePolicy(merchantId, session) {
    const existing = await RecoveryPolicy.findOne({ merchant: merchantId }).session(session);
    if (existing) return existing;
    const [created] = await RecoveryPolicy.create([{ merchant: merchantId }], { session });
    return created;
  }

  async claimExecution({ merchantId, actionId, executionKey }, session) {
    return RecoveryAction.findOneAndUpdate(
      { _id: actionId, merchant: merchantId, status: 'POLICY_ALLOWED', 'execution.idempotencyKey': { $exists: false } },
      { status: 'EXECUTING', 'execution.idempotencyKey': executionKey, 'execution.provider': 'RAZORPAY_TEST' },
      { new: true, session, runValidators: true }
    );
  }

  async markExecuted({ merchantId, actionId, executionKey, providerReference }, session) {
    return RecoveryAction.findOneAndUpdate(
      { _id: actionId, merchant: merchantId, status: 'EXECUTING', 'execution.idempotencyKey': executionKey },
      { status: 'EXECUTED', 'execution.providerReference': providerReference, 'execution.result': 'PAYMENT_LINK_CREATED', 'execution.executedAt': new Date() },
      { new: true, session, runValidators: true }
    );
  }

  async markFailed({ merchantId, actionId, executionKey, error }, session) {
    return RecoveryAction.findOneAndUpdate(
      { _id: actionId, merchant: merchantId, status: 'EXECUTING', 'execution.idempotencyKey': executionKey },
      { status: 'FAILED', 'execution.result': 'PROVIDER_FAILURE', 'execution.error': error, 'execution.executedAt': new Date() },
      { new: true, session, runValidators: true }
    );
  }

  async blockAction({ merchantId, actionId, reason }, session) {
    return RecoveryAction.findOneAndUpdate(
      { _id: actionId, merchant: merchantId, status: 'POLICY_ALLOWED', 'execution.idempotencyKey': { $exists: false } },
      { status: 'BLOCKED', 'policyDecision.decision': 'BLOCKED', 'policyDecision.reason': reason, 'policyDecision.evaluatedAt': new Date() },
      { new: true, session, runValidators: true }
    );
  }

  async updateCaseAfterPaymentLink(recoveryCaseId, session) {
    return RecoveryCase.findByIdAndUpdate(
      recoveryCaseId,
      { status: 'ACTION_PENDING', $inc: { customerContactAttempts: 1 } },
      { new: true, session, runValidators: true }
    );
  }

  async createAuditEvent(data, session) {
    const [event] = await AuditEvent.create([data], { session });
    return event;
  }
}

module.exports = { RecoveryExecutionRepository };
