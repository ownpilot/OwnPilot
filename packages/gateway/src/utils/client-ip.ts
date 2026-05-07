/**
 * Trusted proxy / client-IP resolution (RATE-002, RATE-003).
 *
 * Without a proxy, the only meaningful identity we can assign to a request is
 * the socket peer address — which Node exposes but Hono doesn't expose
 * directly through `c.req`. When a reverse proxy is in front of us, we can
 * accept its `X-Forwarded-For` header — but ONLY if we know the proxy's IP,
 * otherwise any client can spoof XFF and bypass per-IP rate limiting and
 * login throttles.
 *
 * Configuration:
 *   TRUSTED_PROXY=true            — opt in to trusting proxy headers at all.
 *   TRUSTED_PROXY_IPS=ip1,ip2     — comma-separated list of immediate-upstream
 *                                   proxy IPs. Required when TRUSTED_PROXY=true;
 *                                   if missing, we fail safe and ignore XFF.
 *
 * Without socket peer access (the typical Hono case), the best we can do is:
 *   - When TRUSTED_PROXY=true AND TRUSTED_PROXY_IPS is set, take the LAST
 *     entry in `X-Forwarded-For` (closest to our edge — appended by the
 *     trusted proxy itself, attacker can't forge it) rather than the first
 *     entry (client-claimed, fully spoofable).
 *   - Otherwise fall back to a stable bucket key ('direct').
 */

const TRUST_PROXY = process.env.TRUSTED_PROXY === 'true';
const RAW_TRUSTED_PROXY_IPS = process.env.TRUSTED_PROXY_IPS ?? '';
const TRUSTED_PROXY_IPS = RAW_TRUSTED_PROXY_IPS
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** Special sentinel meaning "trust any proxy IP" (useful in tests) */
const TRUST_ANY = TRUSTED_PROXY_IPS.length > 0 && TRUSTED_PROXY_IPS.includes('*');

/**
 * Whether proxy-aware IP extraction is configured safely.
 * `TRUSTED_PROXY=true` without `TRUSTED_PROXY_IPS` is unsafe — we ignore XFF.
 */
export function isProxyAwareConfigured(): boolean {
  return TRUST_PROXY && (TRUSTED_PROXY_IPS.length > 0 || TRUST_ANY);
}

let warnedMisconfig = false;
function warnIfMisconfigured(): void {
  if (TRUST_PROXY && TRUSTED_PROXY_IPS.length === 0 && !warnedMisconfig) {
    warnedMisconfig = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[client-ip] TRUSTED_PROXY=true but TRUSTED_PROXY_IPS is empty — ' +
        'X-Forwarded-For will be IGNORED (fail-safe). Set TRUSTED_PROXY_IPS to ' +
        'a comma-separated list of your reverse-proxy IPs to enable per-IP ' +
        'rate limiting / login throttle.'
    );
  }
}

/**
 * Get a stable client identity from a Hono-style header reader.
 *
 * Returns:
 *   - Last entry of `X-Forwarded-For` (or `X-Real-IP`) when proxy trust is
 *     correctly configured.
 *   - 'direct' otherwise (single-bucket fallback). When this happens, callers
 *     that care about per-client granularity should be aware that all
 *     attackers share the same bucket — but that's safer than the alternative
 *     (every attacker rotates X-Forwarded-For and bypasses the limiter).
 */
export function getClientIp(req: {
  header: (name: string) => string | undefined;
}): string {
  warnIfMisconfigured();

  if (!isProxyAwareConfigured()) return 'direct';

  const xff = req.header('X-Forwarded-For');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }

  const xrealip = req.header('X-Real-IP');
  if (xrealip) return xrealip.trim();

  return 'direct';
}
