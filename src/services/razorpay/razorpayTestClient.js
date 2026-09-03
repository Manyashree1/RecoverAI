const { AppError } = require('../../utils/AppError');

/**
 * Boundary for Razorpay TEST MODE. The application must call this adapter, not
 * the SDK directly. Network execution is paired with webhook verification and
 * an idempotent action-execution workflow in recoveryExecutionService.js.
 */
class RazorpayTestClient {
  constructor({ keyId, keySecret }) {
    this.keyId = keyId;
    this.keySecret = keySecret;
  }

  assertConfigured() {
    if (!this.keyId?.startsWith('rzp_test_') || !this.keySecret) {
      throw new AppError('Razorpay TEST MODE credentials are not configured.', 503);
    }
  }

  async fetchPaymentLink({ paymentLinkId }) {
    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(paymentLinkId)}`, {
        method: 'GET',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`
        },
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.id) {
        throw new AppError('Razorpay payment link could not be fetched.', 404, { providerCode: response.status });
      }

      return {
        id: body.id,
        referenceId: body.reference_id,
        amount: Number(body.amount || 0),
        amountPaid: Number(body.amount_paid || 0),
        currency: body.currency,
        status: body.status,
        providerPaymentId: body.payments?.items?.[0]?.id || body.payments?.items?.[0]?.payment_id || body.payments?.items?.[0]?.payment?.id || null
      };
    } catch (error) {
      if (error.name === 'AbortError') throw new AppError('Razorpay payment-link lookup timed out.', 504);
      if (error instanceof AppError) throw error;
      throw new AppError('Razorpay payment-link lookup failed.', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async createRecoveryPaymentLink({ amount, currency, referenceId, customer }) {
    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          amount,
          currency,
          reference_id: referenceId,
          description: 'RecoverAI payment recovery link',
          customer,
          notify: { email: Boolean(customer.email), sms: Boolean(customer.contact) },
          reminder_enable: true,
          notes: { recoverai_reference: referenceId }
        }),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.id || !body.short_url) {
        throw new AppError('Razorpay could not create a payment link.', 502, { providerCode: response.status });
      }
      return { providerReference: body.id, shortUrl: body.short_url, status: body.status };
    } catch (error) {
      if (error.name === 'AbortError') throw new AppError('Razorpay payment-link request timed out.', 504);
      if (error instanceof AppError) throw error;
      throw new AppError('Razorpay payment-link request failed.', 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { RazorpayTestClient };
