/**
 * App bootstrap sub-path.
 *
 * Re-exports the Hono application factory and the public types that CLI
 * command modules need in order to wire the gateway into their own boot
 * sequence. Kept intentionally narrow — the full surface (middleware,
 * routes, channels, services) is only available via the main `@ownpilot/gateway`
 * barrel.
 */
export { createApp } from './app.js';
export type { GatewayConfig } from './types/index.js';
