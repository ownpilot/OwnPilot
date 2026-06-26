import { getExtensionService as getCoreExtensionService } from '@ownpilot/core/services';
import type { ExtensionService } from './service.js';

export function getGatewayExtensionService(): ExtensionService {
  return getCoreExtensionService() as ExtensionService;
}

export function getExtensionManifestSecurity(manifest: unknown): unknown {
  if (typeof manifest !== 'object' || manifest === null) return null;
  return (manifest as Record<string, unknown>)._security ?? null;
}
