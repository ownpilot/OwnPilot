/**
 * CLI Tool Service Interface
 *
 * Types and interface for the CLI tool discovery, execution, and management system.
 * Unlike coding agents (long-running, session-based), CLI tools are short-lived
 * fire-and-forget executions (linters, formatters, build tools, etc.).
 */

// =============================================================================
// TYPES
// =============================================================================

/** Risk levels for CLI tools */
export type CliToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Per-tool execution policy */
export type CliToolPolicy = 'allowed' | 'prompt' | 'blocked';

/** Supported installation methods */
export type CliInstallMethod = 'npm-global' | 'pnpm-global' | 'npx' | 'system' | 'manual';

/** Tool categories */
export type CliToolCategory =
  | 'linter'
  | 'formatter'
  | 'build'
  | 'test'
  | 'package-manager'
  | 'container'
  | 'version-control'
  | 'coding-agent'
  | 'utility'
  | 'security'
  | 'database';

/** A known CLI tool entry in the catalog */
export interface CliToolCatalogEntry {
  /** Unique identifier (e.g., 'eslint', 'prettier') */
  name: string;
  /** Human-readable name (e.g., 'ESLint') */
  displayName: string;
  /** Short description */
  description: string;
  /** Binary name to look up on PATH (e.g., 'eslint') */
  binaryName: string;
  /** Tool category */
  category: CliToolCategory;
  /** Inherent risk level */
  riskLevel: CliToolRiskLevel;
  /** Default execution policy (derived from risk level) */
  defaultPolicy: CliToolPolicy;
  /** Available installation methods */
  installMethods: CliInstallMethod[];
  /** npm package name for npx execution (e.g., 'prettier') */
  npxPackage?: string;
  /** npm package name for global install */
  npmPackage?: string;
  /** Flag to get version (default: '--version') */
  versionFlag?: string;
  /** Project website */
  website?: string;
  /** Searchable tags */
  tags?: string[];
}

/** Discovery result for a single tool */
export interface CliToolStatus {
  name: string;
  displayName: string;
  category: CliToolCategory;
  riskLevel: CliToolRiskLevel;
  installed: boolean;
  version?: string;
  npxAvailable: boolean;
  policy: CliToolPolicy;
  /** Whether from built-in catalog or user-registered custom provider */
  source: 'catalog' | 'custom';
}

/** Execution result from a CLI tool (lightweight, no sessions) */
export interface CliToolExecutionResult {
  success: boolean;
  toolName: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  error?: string;
  /** Whether output was truncated at the 1MB limit */
  truncated: boolean;
}

// =============================================================================
// SERVICE INTERFACE
// =============================================================================

export interface ICliToolService {
  /** List all available CLI tools with status and policy */
  listTools(userId?: string): Promise<CliToolStatus[]>;

  /** Execute a CLI tool (fire-and-forget, no session) */
  executeTool(
    name: string,
    args: string[],
    cwd: string,
    userId?: string
  ): Promise<CliToolExecutionResult>;

  /** Install a tool via npm/pnpm global install */
  installTool(
    name: string,
    method: CliInstallMethod,
    userId?: string
  ): Promise<CliToolExecutionResult>;

  /** Get the execution policy for a specific tool */
  getToolPolicy(name: string, userId?: string): Promise<CliToolPolicy>;

  /** Set the execution policy for a specific tool */
  setToolPolicy(name: string, policy: CliToolPolicy, userId?: string): Promise<void>;

  /** Clear discovery cache and re-scan */
  refreshDiscovery(): Promise<void>;
}
