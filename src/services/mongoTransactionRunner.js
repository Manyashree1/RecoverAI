const mongoose = require('mongoose');
const { env } = require('../config/env');

class MongoTransactionRunner {
  constructor({ fallbackToDirect = true } = {}) {
    this._fallbackToDirect = fallbackToDirect && env.nodeEnv !== 'production';
    this._transactionsSupported = null;
    this._warned = false;
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
    const supported = await this._areTransactionsSupported();
    const useDirect = !this._fallbackToDirect || !supported;

    if (useDirect) {
      if (env.nodeEnv === 'production') {
        const error = new Error('Production MongoDB does not support transactions. Deploy a replica set or enable MongoDB Atlas transactions.');
        error.statusCode = 500;
        throw error;
      }
      if (!this._warned) {
        this._warned = true;
        console.warn('[MongoTransactionRunner] Transactions not supported; falling back to direct writes. This is unsafe for production recovery flows.');
      }
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
