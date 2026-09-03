const { AppError } = require('../utils/AppError');
const { BatchRecoveryService, MAX_BATCH_LIMIT } = require('../services/batchRecoveryService');

function createBatchRecoveryController({
  batchService = new BatchRecoveryService()
} = {}) {
  return {
    async getStatus(req, res, next) {
      try {
        return res.status(200).json({
          data: {
            maxBatchLimit: MAX_BATCH_LIMIT
          }
        });
      } catch (error) {
        return next(error);
      }
    },

    async runBatch(req, res, next) {
      try {
        const limit = req.body?.limit;
        if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
          throw new AppError('limit must be a positive integer.', 400);
        }

        const result = await batchService.runBatch({
          merchantId: req.auth.merchantId,
          limit
        });

        return res.status(200).json({ data: result });
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = { createBatchRecoveryController };
