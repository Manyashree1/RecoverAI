const ACTION_CAPABILITIES = Object.freeze({
  CUSTOMER_REMINDER: Object.freeze({ executionMode: 'PROVIDER_PAYMENT_LINK', providerExecutable: true, label: 'Creates a Razorpay TEST Payment Link; payment remains pending until provider confirmation.' }),
  RETRY_PAYMENT: Object.freeze({ executionMode: 'REQUIRES_PROVIDER_CHARGE', providerExecutable: false, label: 'Recommendation only: the current Razorpay TEST adapter does not perform a direct charge retry.' }),
  PAYMENT_METHOD_UPDATE: Object.freeze({ executionMode: 'REQUIRES_CUSTOMER', providerExecutable: false, label: 'Recommendation only: requires customer interaction outside the current adapter.' }),
  ESCALATE_TO_HUMAN: Object.freeze({ executionMode: 'REQUIRES_HUMAN', providerExecutable: false, label: 'Human workflow: no automatic provider action is performed.' }),
  NO_ACTION: Object.freeze({ executionMode: 'NO_ACTION', providerExecutable: false, label: 'No financial action is performed.' })
});

function getActionCapability(actionType) {
  return ACTION_CAPABILITIES[actionType] || { executionMode: 'UNSUPPORTED', providerExecutable: false, label: 'Unsupported action type.' };
}

module.exports = { ACTION_CAPABILITIES, getActionCapability };