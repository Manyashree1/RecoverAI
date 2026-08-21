export const currency = (value = 0, currencyCode = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: currencyCode, maximumFractionDigits: 2 }).format(Number(value) / 100);
export const number = (value = 0) => new Intl.NumberFormat('en-IN').format(Number(value));
export const percent = (value = 0) => `${(Number(value) * 100).toFixed(Number(value) * 100 % 1 ? 1 : 0)}%`;
export const dateTime = (value) => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Not recorded';
export const label = (value = '') => String(value).toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
export const failureCategory = (code = '') => {
  const normalized = String(code).toLowerCase();
  if (['insufficient_funds', 'payment_timeout', 'gateway_error', 'network_error', 'bank_declined_temporary'].includes(normalized)) return 'Temporary';
  if (['card_declined', 'expired_card', 'invalid_card', 'card_blocked'].includes(normalized)) return 'Payment method';
  if (['fraud_suspected', 'risk_declined'].includes(normalized)) return 'Risk';
  return 'Unknown';
};
