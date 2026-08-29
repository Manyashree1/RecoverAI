const { AppError } = require('../utils/AppError');
const { computeRecoveryScore } = require('../services/recoveryScoreService');
const { RecoveryRecommendationRepository } = require('../repositories/recoveryRecommendationRepository');

function createRecoveryScoreController({ repository = new RecoveryRecommendationRepository() } = {}) {
  return {
    async getScore(req, res, next) {
      try {
        const context = await repository.findRecoveryCaseWithPayment(req.auth.merchantId, req.params.id);
        if (!context || !context.payment) {
          throw new AppError('Recovery case not found.', 404);
        }

        const { recoveryCase, payment } = context;
        const policy = await repository.findOrCreatePolicy(req.auth.merchantId);

        const result = computeRecoveryScore({ payment, recoveryCase, policy });
        return res.status(200).json({ data: result });
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = { createRecoveryScoreController };
