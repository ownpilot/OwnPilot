/**
 * Module Resolver
 *
 * Solves the pnpm strict mode problem: tools in @ownpilot/core need packages
 * (sharp, pdf-parse, pdfkit, music-metadata, nodemailer, imapflow) that are
 * installed in @ownpilot/gateway. In pnpm strict mode, each workspace package
 * has isolated node_modules and can only resolve its own dependencies.
 *
 * Gateway registers its import context at startup via setModuleResolver().
 * Core tools use tryImport() which falls back to the registered resolver.
 */

// Registered resolver from the host package (gateway)
let _resolver: ((moduleName: string) => Promise<unknown>) | null = null;

/**
 * Register a module resolver from the host package.
 * Call this early in the host's startup (e.g., gateway's server.ts).
 *
 * The resolver should use the host's own `import()` so that module resolution
 * happens from the host's node_modules context.
 *
 * @example
 * // In gateway/src/server.ts:
 * import { setModuleResolver } from '@ownpilot/core';
 * setModuleResolver((name) => import(name));
 */
export function setModuleResolver(resolver: (moduleName: string) => Promise<unknown>): void {
  _resolver = resolver;
}

/**
 * Try to dynamically import a module.
 * First attempts standard import() (works if the module is a direct dependency).
 * Falls back to the registered host resolver (works for gateway's dependencies).
 *
 * @throws Error if module is not found via either method
 */
export async function tryImport(moduleName: string): Promise<unknown> {
  // First try standard dynamic import (resolves from core's context)
  try {
    return await import(moduleName);
  } catch {
    // Module not in core's node_modules — fall through to resolver
  }

  // Try registered resolver (resolves from gateway's context)
  if (_resolver) {
    return await _resolver(moduleName);
  }

  throw new Error(
    `Module '${moduleName}' not found. Ensure it is installed in the gateway package ` +
    `and setModuleResolver() was called during startup.`
  );
}
