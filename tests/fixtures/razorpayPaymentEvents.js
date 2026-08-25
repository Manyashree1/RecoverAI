function failedPaymentEvent(overrides = {}) {
  return {
    entity: 'event',
    account_id: 'acc_test_recoverai',
    event: 'payment.failed',
    created_at: 1760000000,
    payload: {
      payment: {
        entity: {
          id: 'pay_failed_001',
          entity: 'payment',
          amount: 499900,
          currency: 'INR',
          order_id: 'order_001',
          customer_id: 'cust_001',
          email: 'customer@example.test',
          contact: '+919900000001',
          status: 'failed',
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Payment could not be completed.',
          created_at: 1760000000
        }
      }
    },
    ...overrides
  };
}

function capturedPaymentEvent(overrides = {}) {
  const event = failedPaymentEvent({ event: 'payment.captured' });
  event.payload.payment.entity.status = 'captured';
  delete event.payload.payment.entity.error_code;
  delete event.payload.payment.entity.error_description;
  return { ...event, ...overrides };
}

function paymentLinkPaidEvent({ referenceId = 'ra_action_001', paymentLinkId = 'plink_001', paymentId = 'pay_recovery_001', amountPaid = 499900, accountId = 'acc_test_recoverai', ...overrides } = {}) {
  return {
    entity: 'event',
    account_id: accountId,
    event: 'payment_link.paid',
    created_at: 1760000100,
    payload: {
      payment_link: { entity: { id: paymentLinkId, amount: 499900, amount_paid: amountPaid, currency: 'INR', reference_id: referenceId, status: 'paid' } },
      payment: { entity: { id: paymentId, amount: amountPaid, currency: 'INR', status: 'captured', created_at: 1760000100 } }
    },
    ...overrides
  };
}

module.exports = { failedPaymentEvent, capturedPaymentEvent, paymentLinkPaidEvent };

