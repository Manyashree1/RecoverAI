const express = require('express');
const mongoose = require('mongoose');
const { env } = require('../config/env');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'recoverai-api',
    version: '0.1.0'
  });
});

router.get('/transactions', async (req, res) => {
  try {
    const admin = mongoose.connection.db.admin();
    const status = await admin.command({ replSetGetStatus: 1 });
    res.status(200).json({ transactionsSupported: true, replicaSet: status.set });
  } catch {
    res.status(200).json({ transactionsSupported: false, message: 'Run MongoDB as a single-node replica set for transaction support.' });
  }
});

router.get('/webhook-info', (req, res) => {
  const webhookUrl = env.publicWebhookUrl || `${req.protocol}://${req.get('host')}/api/webhooks/razorpay`;
  const configured = Boolean(env.publicWebhookUrl);
  res.status(200).json({
    webhookUrl: configured ? webhookUrl : null,
    configured,
    path: '/api/webhooks/razorpay'
  });
});

module.exports = { healthRouter: router };

