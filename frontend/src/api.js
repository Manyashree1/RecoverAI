const TOKEN_KEY = 'recoverai.session';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveSession(payload) {
  localStorage.setItem(TOKEN_KEY, payload.token);
  localStorage.setItem('recoverai.user', JSON.stringify(payload.user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('recoverai.user');
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem('recoverai.user') || 'null');
  } catch {
    return null;
  }
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    clearSession();
    window.dispatchEvent(new Event('recoverai:unauthorized'));
  }
  if (!response.ok) throw new Error(body.error?.message || body.message || 'Something went wrong.');
  return body;
}

export const api = {
  login: (email, password) => apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  overview: () => apiFetch('/api/analytics/overview'),
  payments: (params = {}) => apiFetch(`/api/payments?${new URLSearchParams(params)}`),
  payment: (id) => apiFetch(`/api/payments/${id}`),
  cases: (params = {}) => apiFetch(`/api/recovery-cases?${new URLSearchParams(params)}`),
  case: (id) => apiFetch(`/api/recovery-cases/${id}`),
  audit: (params = {}) => apiFetch(`/api/audit-events?${new URLSearchParams(params)}`),
  recoveryActions: (params = {}) => apiFetch(`/api/recovery-actions?${new URLSearchParams(params)}`),
  recommend: (id) => apiFetch(`/api/recovery-cases/${id}/recommendations`, { method: 'POST' }),
  newRecoveryAttempt: (id) => apiFetch(`/api/recovery-cases/${id}/recovery-attempts`, { method: 'POST' }),
  execute: (id) => apiFetch(`/api/recovery-actions/${id}/execute`, { method: 'POST' })
};
