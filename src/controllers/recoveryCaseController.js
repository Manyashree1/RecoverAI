const { AppError } = require('../utils/AppError');
const { ReadRepository } = require('../repositories/readRepository');
const { RecoveryRecommendationService } = require('../services/recoveryRecommendationService');
const { toPublicJSON } = require('../utils/serialize');
const { parsePagination } = require('../utils/pagination');

function createRecoveryCaseController({
  repository = new ReadRepository(),
  recommendationService = new RecoveryRecommendationService()
} = {}) {
  return {
    async list(req, res, next) {
      try {
        const { page, limit } = parsePagination(req.query);
        const { items, pagination } = await repository.listRecoveryCases(req.auth.merchantId, {
          status: req.query.status,
          page,
          limit
        });
        return res.status(200).json({ data: items.map(toPublicJSON), pagination });
      } catch (error) {
        return next(error);
      }
    },

    async getById(req, res, next) {
      try {
        const recoveryCase = await repository.findRecoveryCaseById(req.auth.merchantId, req.params.id);
        if (!recoveryCase) throw new AppError('Recovery case not found.', 404);
        return res.status(200).json({ data: toPublicJSON(recoveryCase) });
      } catch (error) {
        return next(error);
      }
    },

    // Generates (or returns the existing, idempotent) deterministic
    // recovery recommendation for this case. This ONLY records a
    // recommendation plus the policy engine's ALLOW/BLOCK verdict -- it
    // never executes a financial action.
    async createRecommendation(req, res, next) {
      try {
        const result = await recommendationService.generateRecommendation({
          merchantId: req.auth.merchantId,
          recoveryCaseId: req.params.id
        });
        return res.status(result.duplicate ? 200 : 201).json(result);
      } catch (error) {
        return next(error);
      }
    },

    async createRecoveryAttempt(req, res, next) {
      try {
        const result = await recommendationService.generateRecommendation({
          merchantId: req.auth.merchantId,
          recoveryCaseId: req.params.id,
          newAttempt: true
        });
        return res.status(result.duplicate ? 200 : 201).json(result);
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = { createRecoveryCaseController };
