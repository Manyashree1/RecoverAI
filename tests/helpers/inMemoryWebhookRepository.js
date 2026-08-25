class InMemoryWebhookRepository {
  constructor({ failAuditEvent = false } = {}) {
    this.state = {
      merchants: [{ _id: 'merchant_001', razorpayAccountId: 'acc_test_recoverai', status: 'ACTIVE' }],
      customers: [],
      payments: [],
      recoveryCases: [],
      recoveryActions: [],
      auditEvents: [],
      webhookEvents: []
    };
    this.failAuditEvent = failAuditEvent;
    this.sequence = 0;
  }

  nextId(prefix) {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  async findMerchantByAccountId(accountId) {
    return this.state.merchants.find((merchant) => merchant.razorpayAccountId === accountId && merchant.status === 'ACTIVE');
  }

  async findWebhookEvent(providerEventId) {
    return this.state.webhookEvents.find((event) => event.provider === 'RAZORPAY' && event.providerEventId === providerEventId);
  }

  async createWebhookEvent(data) {
    if (await this.findWebhookEvent(data.providerEventId)) throw duplicateKeyError();
    const event = { _id: this.nextId('webhook'), status: 'RECEIVED', ...data };
    this.state.webhookEvents.push(event);
    return event;
  }

  async markWebhookEventProcessed(eventId, paymentId) {
    const event = this.state.webhookEvents.find((candidate) => candidate._id === eventId);
    Object.assign(event, { status: 'PROCESSED', payment: paymentId, processedAt: new Date() });
    return event;
  }

  async findPaymentByRazorpayPaymentId(razorpayPaymentId) {
    return this.state.payments.find((payment) => payment.razorpayPaymentId === razorpayPaymentId);
  }

  async findRecoveryActionByReference({ merchantId, referenceId, paymentLinkId }) {
    const actionId = referenceId.startsWith('ra_') ? referenceId.slice(3) : '';
    const action = this.state.recoveryActions.find((candidate) => candidate._id === actionId && candidate.merchant === merchantId && candidate.type === 'CUSTOMER_REMINDER' && candidate.status === 'EXECUTED' && candidate.execution?.provider === 'RAZORPAY_TEST' && candidate.execution?.providerReference === paymentLinkId);
    if (!action) return null;
    return {
      action,
      recoveryCase: this.state.recoveryCases.find((candidate) => candidate._id === action.recoveryCase && candidate.merchant === merchantId),
      payment: this.state.payments.find((candidate) => candidate._id === action.payment && candidate.merchant === merchantId)
    };
  }

  async confirmRecovery({ merchantId, actionId, providerPaymentId, amount, currency }) {
    const action = this.state.recoveryActions.find((candidate) => candidate._id === actionId && candidate.merchant === merchantId && candidate.status === 'EXECUTED' && candidate.execution?.result === 'PAYMENT_LINK_CREATED' && !candidate.execution?.providerPaymentId);
    if (!action) return { confirmed: false };
    const payment = this.state.payments.find((candidate) => candidate._id === action.payment && candidate.merchant === merchantId);
    if (!payment) throw new Error('Payment could not be completed for the confirmed payment link.');
    Object.assign(payment, { status: 'CAPTURED', amount, currency });
    const recoveryCase = this.state.recoveryCases.find((candidate) => candidate._id === action.recoveryCase && candidate.merchant === merchantId && !['RECOVERED', 'CLOSED'].includes(candidate.status) && candidate.recoveredAmount === 0);
    if (!recoveryCase) throw new Error('Recovery case could not be completed for the confirmed payment.');
    Object.assign(action.execution, { providerPaymentId, result: 'PAYMENT_CONFIRMED', confirmedAt: new Date() });
    Object.assign(recoveryCase, { status: 'RECOVERED', recoveredAmount: amount, resolvedAt: new Date() });
    return { confirmed: true, action, recoveryCase, payment };
  }

  async reconcileConfirmedRecovery({ merchantId, actionId, providerPaymentId, amount, currency }) {
    const action = this.state.recoveryActions.find((candidate) => candidate._id === actionId && candidate.merchant === merchantId && candidate.status === 'EXECUTED' && candidate.execution?.result === 'PAYMENT_CONFIRMED' && candidate.execution?.providerPaymentId === providerPaymentId);
    if (!action) return { reconciled: false };
    const payment = this.state.payments.find((candidate) => candidate._id === action.payment && candidate.merchant === merchantId);
    if (payment.status !== 'CAPTURED') Object.assign(payment, { status: 'CAPTURED', amount, currency });
    return { reconciled: true, payment };
  }

  async resolveCustomer(merchantId, payment) {
    let customer = this.state.customers.find(
      (candidate) => payment.customerId && candidate.merchant === merchantId && candidate.externalCustomerId === payment.customerId
    );
    if (!customer && payment.email) customer = this.state.customers.find((candidate) => candidate.merchant === merchantId && candidate.email === payment.email);
    if (!customer && payment.contact) customer = this.state.customers.find((candidate) => candidate.merchant === merchantId && candidate.phone === payment.contact);
    if (customer) return customer;

    customer = {
      _id: this.nextId('customer'),
      merchant: merchantId,
      externalCustomerId: payment.customerId,
      email: payment.email,
      phone: payment.contact
    };
    this.state.customers.push(customer);
    return customer;
  }

  async createPayment(data) {
    if (await this.findPaymentByRazorpayPaymentId(data.razorpayPaymentId)) throw duplicateKeyError();
    const payment = { _id: this.nextId('payment'), ...data };
    this.state.payments.push(payment);
    return payment;
  }

  async updatePayment(paymentId, update) {
    const payment = this.state.payments.find((candidate) => candidate._id === paymentId);
    Object.assign(payment, update);
    return payment;
  }

  async findRecoveryCaseByPayment(paymentId) {
    return this.state.recoveryCases.find((recoveryCase) => recoveryCase.payment === paymentId);
  }

  async createRecoveryCase(data) {
    if (await this.findRecoveryCaseByPayment(data.payment)) throw duplicateKeyError();
    const recoveryCase = { _id: this.nextId('case'), ...data };
    this.state.recoveryCases.push(recoveryCase);
    return recoveryCase;
  }

  async closeRecoveryCase(recoveryCaseId) {
    const recoveryCase = this.state.recoveryCases.find((candidate) => candidate._id === recoveryCaseId);
    Object.assign(recoveryCase, { status: 'CLOSED', resolvedAt: new Date() });
    return recoveryCase;
  }

  async createAuditEvent(data) {
    if (this.failAuditEvent) throw new Error('Simulated database failure while writing audit event.');
    if (this.state.auditEvents.some((event) => event.providerEventId === data.providerEventId && event.type === data.type)) {
      throw duplicateKeyError();
    }
    const auditEvent = { _id: this.nextId('audit'), ...data };
    this.state.auditEvents.push(auditEvent);
    return auditEvent;
  }
}

class InMemoryTransactionRunner {
  constructor(repository) {
    this.repository = repository;
  }

  async run(work) {
    const snapshot = structuredClone(this.repository.state);
    const sequence = this.repository.sequence;
    try {
      return await work({});
    } catch (error) {
      this.repository.state = snapshot;
      this.repository.sequence = sequence;
      throw error;
    }
  }
}

function duplicateKeyError() {
  const error = new Error('Duplicate key');
  error.code = 11000;
  return error;
}

module.exports = { InMemoryWebhookRepository, InMemoryTransactionRunner, duplicateKeyError };

