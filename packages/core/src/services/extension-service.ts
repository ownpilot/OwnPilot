/**
 * IExtensionService - User Extension Management Interface
 *
 * Manages user extensions (native tool bundles and AgentSkills.io skills).
 * Handles installation, enabling/disabling, and tool definition export.
 *
 * Usage:
 *   const extensions = registry.get(Services.Extension);
 *   const ext = await extensions.install('/path/to/manifest.json');
 *   const tools = extensions.getToolDefinitions();
 */

// ============================================================================
// Types
// ============================================================================

export interface ExtensionInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly category: string;
  readonly format: string;
  readonly status: 'enabled' | 'disabled' | 'error';
  readonly toolCount: number;
  readonly triggerCount: number;
}

export interface ExtensionScanResult {
  readonly installed: number;
  readonly errors: Array<{ path: string; error: string }>;
}

// ============================================================================
// IExtensionService
// ============================================================================

export interface IExtensionService {
  /**
   * Install an extension from a manifest file path.
   */
  install(manifestPath: string, userId?: string): Promise<ExtensionInfo>;

  /**
   * Enable an extension.
   */
  enable(id: string, userId?: string): Promise<ExtensionInfo | null>;

  /**
   * Disable an extension.
   */
  disable(id: string, userId?: string): Promise<ExtensionInfo | null>;

  /**
   * Get all installed extensions.
   */
  getAll(): ExtensionInfo[];

  /**
   * Get all enabled extensions.
   */
  getEnabled(): ExtensionInfo[];

  /**
   * Get tool definitions from all enabled extensions.
   */
  getToolDefinitions(): unknown[];

  /**
   * Scan a directory for new extensions to install.
   */
  scanDirectory(directory?: string, userId?: string): Promise<ExtensionScanResult>;

  /**
   * Get system prompt sections from enabled extensions.
   */
  getSystemPromptSections(): string[];
}
