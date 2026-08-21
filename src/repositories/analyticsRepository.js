const Payment = require('../models/Payment');
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryAction = require('../models/RecoveryAction');
const AuditEvent = require('../models/AuditEvent');

class AnalyticsRepository {
  async loadMerchantAnalytics(merchantId) {
    const [payments, recoveryCases, recoveryActions, auditEvents] = await Promise.all([
      Payment.find({ merchant: merchantId }).lean(),
      RecoveryCase.find({ merchant: merchantId }).lean(),
      RecoveryAction.find({ merchant: merchantId }).lean(),
      AuditEvent.find({ merchant: merchantId }).lean()
    ]);
    return { payments, recoveryCases, recoveryActions, auditEvents };
  }
}

module.exports = { AnalyticsRepository };
