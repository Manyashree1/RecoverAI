const express = require('express');
const { createAuthController } = require('../controllers/authController');

function createAuthRouter({ controller = createAuthController() } = {}) {
  const router = express.Router();
  router.post('/login', controller.login);
  return router;
}

module.exports = { createAuthRouter };
