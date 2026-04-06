/**
 * Docker URL rewriting utility
 *
 * When the gateway runs inside a Docker container, URLs pointing to
 * localhost / 127.0.0.1 can't reach services on the host.  This module
 * provides a single helper that transparently rewrites those URLs to
 * `host.docker.internal` so every outbound fetch works regardless of
 * whether the gateway runs natively or in Docker.
 *
 * Detection: we check for OWNPILOT_DATA_DIR=/app/data (set in
 * docker-compose.dev.yml) or an explicit DOCKER=1 flag.
 */

const IS_DOCKER =
  process.env.OWNPILOT_DATA_DIR === '/app/data' || process.env.DOCKER === '1';

/**
 * If we're inside Docker, rewrite `localhost` / `127.0.0.1` to
 * `host.docker.internal`.  Outside Docker this is a no-op.
 */
export function rewriteLocalUrl(url: string): string {
  if (!IS_DOCKER) return url;
  return url
    .replace(/\/\/127\.0\.0\.1([:/])/g, '//host.docker.internal$1')
    .replace(/\/\/localhost([:/])/g, '//host.docker.internal$1');
}
