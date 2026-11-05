/**
 * Browser client for the ProRack Move /api (served by Convex, backed by ERP).
 * Same-origin calls with the HttpOnly session cookie; POSTs carry a custom header the API requires.
 */
async function call(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json', 'x-prorack-move': '1' };
    init.body = JSON.stringify(body ?? {});
  }
  let res;
  try { res = await fetch(path, init); }
  catch { throw Object.assign(Error('Cannot reach ProRack Move. Check your connection and try again.'), { status: 0 }); }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw Object.assign(Error(data?.error || `Request failed (HTTP ${res.status})`), { status: res.status, data });
  return data;
}

/**
 * Should the browser-only ERP preview (sample data, no backend) start for this address?
 * An explicit ?preview=erp or #preview-erp always wins, then ?demo=1 or #demo for the older persona demo.
 * With neither, only Netlify's own *.netlify.app addresses default to it; localhost and Convex never do.
 */
export function wantsErpPreview({ search = '', hash = '', hostname = '' } = {}) {
  const params = new URLSearchParams(search);
  if (params.get('preview') === 'erp' || hash === '#preview-erp') return true;
  if (params.get('demo') === '1' || hash === '#demo') return false;
  return /\.netlify\.app$/i.test(hostname);
}

/** Returns the ERP config when the app is served by the Convex backend, otherwise null (local demo). */
export async function detectErpMode() {
  try {
    const res = await fetch('/api/auth/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok || !String(res.headers.get('content-type') || '').includes('application/json')) return null;
    const cfg = await res.json();
    return cfg?.mode === 'erp' ? cfg : null;
  } catch { return null; }
}

export const erpApi = {
  me: () => call('GET', '/api/me'),
  lookups: () => call('GET', '/api/lookups'),
  requests: (scope = 'mine') => call('GET', scope === 'all' ? '/api/travel-requests?scope=all' : '/api/travel-requests'),
  create: (request, policy, submit) => call('POST', '/api/travel-requests', { request, policy, submit }),
  passcode: (email, passcode) => call('POST', '/api/auth/passcode', { email, passcode }),
  logout: () => call('POST', '/api/auth/logout', {})
};
