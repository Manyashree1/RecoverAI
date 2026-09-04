const mongoose = require('mongoose');
const { env } = require('./env');

async function connectDatabase() {
  const uri = env.nodeEnv === 'test' ? env.testMongoUri : env.mongoUri;
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
}

function assertTestDatabase() {
  if (!mongoose.connection.db) {
    throw new Error('No active database connection.');
  }
  const dbName = String(mongoose.connection.db.databaseName);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing destructive cleanup against non-test database "${dbName}". Expected a database name ending in "_test".`);
  }
}

module.exports = { connectDatabase, assertTestDatabase };

