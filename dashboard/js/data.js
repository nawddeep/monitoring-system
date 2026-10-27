// Data source: the read-only dashboard API (see API.md).
//   GET {apiBase}/snapshot?from=ISO&to=ISO  ->  snapshot shaped like the database tables.

export class NotConfiguredError extends Error {}

export function createSource(cfg) {
  const base = typeof cfg.apiBase === 'string' ? cfg.apiBase.trim().replace(/\/+$/, '') : '';
  return {
    kind: 'api',
    path: base || null,
    async load({ from, to }) {
      if (!base) throw new NotConfiguredError('No data API configured. Set "apiBase" in dashboard/config.json.');
      const url = new URL(`${base}/snapshot`, location.href);
      url.searchParams.set('from', new Date(from).toISOString());
      url.searchParams.set('to', new Date(to).toISOString());
      const sameOrigin = url.origin === location.origin;
      const timeoutS = Number(cfg.requestTimeoutSeconds) || 15;
      let res;
      try {
        res = await fetch(url, {
          credentials: sameOrigin ? 'same-origin' : 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutS * 1000),
        });
      } catch (err) {
        const why = err?.name === 'TimeoutError' ? `no response within ${timeoutS} s` : 'the request failed (network, CORS or blocked by the browser)';
        throw new Error(`Could not reach the data API at ${url.origin}${url.pathname}: ${why}.`);
      }
      if (res.status === 401) {
        if (cfg.loginPath) {
          location.assign(cfg.loginPath);
          return null;
        }
        throw new Error('The data API requires a login (HTTP 401).');
      }
      if (!res.ok) throw new Error(`The data API returned HTTP ${res.status}.`);
      return res.json();
    },
  };
}
