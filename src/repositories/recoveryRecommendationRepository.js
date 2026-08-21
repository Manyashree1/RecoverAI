const Payment = require('../models/Payment');
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryPolicy = require('../models/RecoveryPolicy');
const RecoveryAction = require('../models/RecoveryAction');
const AuditEvent = require('../models/AuditEvent');

class RecoveryRecommendationRepository {
  /** Merchant-scoped: returns null if the case does not exist or belongs to another merchant. */
  async findRecoveryCaseWithPayment(merchantId, recoveryCaseId, session) {
    const recoveryCase = await RecoveryCase.findOne({ _id: recoveryCaseId, merchant: merchantId }).session(session);
    if (!recoveryCase) return null;
    const payment = await Payment.findOne({ _id: recoveryCase.payment, merchant: merchantId }).session(session);
    return { recoveryCase, payment };
  }

  /**
   * The RecoveryPolicy model's schema defaults already encode the merchant
   * defaults, so a merchant that has never configured a policy still gets a
   * safe, conservative baseline instead of the recommendation pipeline
   * failing outright.
   */
  async findOrCreatePolicy(merchantId, session) {
    const existing = await RecoveryPolicy.findOne({ merchant: merchantId }).session(session);
    if (existing) return existing;
    const [created] = await RecoveryPolicy.create([{ merchant: merchantId }], { session });
    return created;
  }

  async findRecoveryActionByIdempotencyKey(idempotencyKey, session) {
    return RecoveryAction.findOne({ idempotencyKey }).session(session);
  }

  async createRecoveryAction(data, session) {
    const [action] = await RecoveryAction.create([data], { session });
    return action;
  }

  async createAuditEvent(data, session) {
    const [event] = await AuditEvent.create([data], { session });
    return event;
  }
}

module.exports = { RecoveryRecommendationRepository };
