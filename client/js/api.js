const TOKEN_KEY = "apex_poker_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    throw new Error((body && body.error) || `Request failed (${res.status})`);
  }
  return body;
}

export const api = {
  register: (email, username, password) =>
    request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, username, password }) }),
  login: (email, password) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  me: () => request("/api/me"),
  balance: () => request("/api/wallet/balance"),
  history: () => request("/api/wallet/history"),
  deposit: (amount) => request("/api/wallet/deposit", { method: "POST", body: JSON.stringify({ amount }) }),
  withdraw: (amount) => request("/api/wallet/withdraw", { method: "POST", body: JSON.stringify({ amount }) }),
  adminCredit: (username, amount) =>
    request("/api/admin/credit", { method: "POST", body: JSON.stringify({ username, amount }) }),
  tables: () => request("/api/tables"),
};
