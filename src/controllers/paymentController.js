const { AppError } = require('../utils/AppError');
const { ReadRepository } = require('../repositories/readRepository');
const { toPublicJSON } = require('../utils/serialize');
const { parsePagination } = require('../utils/pagination');

function createPaymentController({ repository = new ReadRepository() } = {}) {
  return {
    async list(req, res, next) {
      try {
        const { page, limit } = parsePagination(req.query);
        const { items, pagination } = await repository.listPayments(req.auth.merchantId, {
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
        const payment = await repository.findPaymentById(req.auth.merchantId, req.params.id);
        if (!payment) throw new AppError('Payment not found.', 404);
        return res.status(200).json({ data: toPublicJSON(payment) });
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = { createPaymentController };
