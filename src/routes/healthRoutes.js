const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'recoverai-api',
    version: '0.1.0'
  });
});

module.exports = { healthRouter: router };

