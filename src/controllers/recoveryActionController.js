const { AppError } = require('../utils/AppError');
const { ReadRepository } = require('../repositories/readRepository');
const { toPublicJSON } = require('../utils/serialize');
const { parsePagination } = require('../utils/pagination');
const { RecoveryExecutionService } = require('../services/recoveryExecutionService');

function createRecoveryActionController({ executionService = new RecoveryExecutionService(), repository = new ReadRepository() } = {}) {
  return {
    async reconcilePaidLink(req, res, next) {
      try {
        const result = await executionService.reconcileAlreadyPaidLink({
          merchantId: req.auth.merchantId,
          paymentLinkId: req.body?.paymentLinkId || req.params?.id
        });
        const status = result.outcome === 'RECOVERED' ? 200 : result.outcome === 'PENDING' ? 202 : result.outcome === 'REJECTED' ? 422 : 200;
        return res.status(status).json(result);
      } catch (error) {
        return next(error);
      }
    },
    async execute(req, res, next) {
      try {
        const result = await executionService.execute({ merchantId: req.auth.merchantId, actionId: req.params.id });
        const status = result.outcome === 'EXECUTED' ? 201 : result.outcome === 'IN_PROGRESS' ? 202 : 200;
        return res.status(status).json(result);
      } catch (error) {
        return next(error);
      }
    },
    async list(req, res, next) {
      try {
        const { page, limit } = parsePagination(req.query);
        const { items, pagination } = await repository.listRecoveryActions(req.auth.merchantId, { page, limit });
        return res.status(200).json({ data: items.map(toPublicJSON), pagination });
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = { createRecoveryActionController };
