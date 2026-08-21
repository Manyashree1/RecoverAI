const mongoose = require('mongoose');
const { env } = require('./env');

async function connectDatabase() {
  await mongoose.connect(env.mongoUri);
  console.log('Connected to MongoDB');
}

module.exports = { connectDatabase };

