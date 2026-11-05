/**
 * Sign-in helpers: Microsoft Entra ID (OAuth 2.0 authorization code + PKCE, confidential client)
 * and session cookies. Pure Web Crypto, no Convex imports, so it is unit-testable.
 *
 * Env: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, optional APP_BASE_URL (defaults to
 * CONVEX_SITE_URL), optional UAT_LOGIN_PASSCODE (temporary UAT sign-in), TRAVEL_ADMIN_EMAILS.
 */

export const SESSION_COOKIE = 'pm_session';
export const SESSION_HOURS = 12;
export const STATE_MINUTES = 10;

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}
export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function pkceChallenge(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
}

/** Constant-time string comparison for the UAT passcode. */
export function safeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function appBaseUrl(env) {
  return String(env.APP_BASE_URL || env.CONVEX_SITE_URL || '').replace(/\/+$/, '');
}
export function microsoftConfig(env) {
  const tenant = String(env.MS_TENANT_ID || '').trim(), clientId = String(env.MS_CLIENT_ID || '').trim(), secret = String(env.MS_CLIENT_SECRET || '').trim();
  return { tenant, clientId, secret, configured: Boolean(tenant && clientId && secret), redirectUri: `${appBaseUrl(env)}/api/auth/callback` };
}

export async function authorizeUrl(env, { state, verifier }) {
  const ms = microsoftConfig(env);
  const u = new URL(`https://login.microsoftonline.com/${encodeURIComponent(ms.tenant)}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({
    client_id: ms.clientId, response_type: 'code', redirect_uri: ms.redirectUri, response_mode: 'query',
    scope: 'openid profile email', state, code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256', prompt: 'select_account'
  }).toString();
  return u.toString();
}

/** Exchange the code at Entra's token endpoint and return the verified-by-transport ID token claims. */
export async function exchangeCode(env, { code, verifier }, fetchImpl = fetch) {
  const ms = microsoftConfig(env);
  const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(ms.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: ms.clientId, client_secret: ms.secret, grant_type: 'authorization_code', code, redirect_uri: ms.redirectUri, code_verifier: verifier, scope: 'openid profile email' }).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(data.error_description || data.error || `Microsoft sign-in failed (HTTP ${res.status})`);
  // The token came straight from Entra over TLS to this confidential client (OIDC Core 3.1.3.7),
  // so the signature check is not required; issuer, audience, tenant and expiry are still checked.
  const claims = decodeJwtPayload(data.id_token);
  checkClaims(claims, ms);
  return claims;
}

export function decodeJwtPayload(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new Error('Malformed ID token');
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
}

export function checkClaims(c, ms, now = Date.now()) {
  if (c.aud !== ms.clientId) throw new Error('ID token was issued for a different app');
  if (String(c.tid || '').toLowerCase() !== ms.tenant.toLowerCase() && !/^(common|organizations)$/i.test(ms.tenant)) throw new Error('Account is not in the ProRack tenant');
  if (!/^https:\/\/login\.microsoftonline\.com\/[^/]+\/v2\.0$/.test(String(c.iss || ''))) throw new Error('Unexpected token issuer');
  if (!c.exp || c.exp * 1000 < now - 60000) throw new Error('ID token has expired');
  return true;
}
export const emailFromClaims = c => String(c.email || c.preferred_username || c.upn || '').trim().toLowerCase();

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function sessionCookie(token, { maxAgeSeconds = SESSION_HOURS * 3600 } = {}) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function adminEmails(env) {
  return String(env.TRAVEL_ADMIN_EMAILS || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
