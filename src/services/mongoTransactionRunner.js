const mongoose = require('mongoose');

class MongoTransactionRunner {
  constructor({ fallbackToDirect = true } = {}) {
    this._fallbackToDirect = fallbackToDirect;
    this._transactionsSupported = null;
  }

  async _areTransactionsSupported() {
    if (this._transactionsSupported !== null) {
      return this._transactionsSupported;
    }

    try {
      const admin = mongoose.connection.db.admin();
      const status = await admin.command({ replSetGetStatus: 1 });
      this._transactionsSupported = Boolean(status && status.set);
    } catch (error) {
      this._transactionsSupported = false;
    }

    return this._transactionsSupported;
  }

  async run(work) {
    const useDirect = !this._fallbackToDirect || !(await this._areTransactionsSupported());

    if (useDirect) {
      return work(null);
    }

    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}

module.exports = { MongoTransactionRunner };
