const { AppError } = require('../../utils/AppError');

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000];

function isRetryableStatus(status) {
  return !status || status === 502 || status === 503 || status === 504;
}

function retryable(error) {
  if (error?.name === 'AbortError') return true;
  if (error instanceof AppError && isRetryableStatus(error.statusCode)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RazorpayTestClient {
  constructor({ keyId, keySecret, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.timeoutMs = timeoutMs;
  }

  assertConfigured() {
    if (!this.keyId?.startsWith('rzp_test_') || !this.keySecret) {
      throw new AppError('Razorpay TEST MODE credentials are not configured.', 503);
    }
  }

  async fetchPaymentLink(paymentLinkId, attempt = 1) {
    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
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
      if (attempt < MAX_RETRIES && retryable(error)) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
        return this.fetchPaymentLink(paymentLinkId, attempt + 1);
      }
      if (error.name === 'AbortError') throw new AppError(`Razorpay payment-link lookup timed out after ${this.timeoutMs}ms. Check network connectivity and retry.`, 504);
      if (error instanceof AppError) throw error;
      throw new AppError('Razorpay payment-link lookup failed.', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async createRecoveryPaymentLink({ amount, currency, referenceId, customer }, attempt = 1) {
    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
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
      if (attempt < MAX_RETRIES && retryable(error)) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
        return this.createRecoveryPaymentLink({ amount, currency, referenceId, customer }, attempt + 1);
      }
      if (error.name === 'AbortError') throw new AppError(`Razorpay payment-link request timed out after ${this.timeoutMs}ms. Check network connectivity and retry.`, 504);
      if (error instanceof AppError) throw error;
      throw new AppError('Razorpay payment-link request failed.', 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { RazorpayTestClient };
