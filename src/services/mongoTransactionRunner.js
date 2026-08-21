const mongoose = require('mongoose');

class MongoTransactionRunner {
  async run(work) {
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

