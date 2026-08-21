const { app } = require('./app');
const { env } = require('./config/env');
const { connectDatabase } = require('./config/database');

async function startServer() {
  await connectDatabase();
  app.listen(env.port, () => {
    console.log(`RecoverAI API listening on port ${env.port}`);
  });
}

startServer().catch((error) => {
  console.error('Unable to start RecoverAI API:', error.message);
  process.exit(1);
});

