/**
 * Docker Sandbox for Code Execution
 *
 * Provides real isolation for executing untrusted code.
 * Code runs inside a Docker container with:
 * - No network access (--network none)
 * - Limited memory and CPU
 * - Read-only root filesystem
 * - No privileged access
 * - Timeout enforcement
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getLog } from '../services/get-log.js';
import { getErrorMessage } from '../services/error-utils.js';

const execAsync = promisify(exec);
const log = getLog('Sandbox');

// Sandbox configuration
export interface SandboxConfig {
  /** Docker image to use (default: python:3.11-slim for Python, node:20-slim for JS) */
  image?: string;
  /** Maximum execution time in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum memory in MB (default: 256) */
  memoryMB?: number;
  /** Maximum CPU cores (default: 1) */
  cpus?: number;
  /** Allow network access (default: false) */
  networkEnabled?: boolean;
  /** Working directory inside container */
  workDir?: string;
  /** Environment variables to pass */
  env?: Record<string, string>;
  /** Skip --no-new-privileges flag for Docker compatibility (default: false) */
  relaxedSecurity?: boolean;
}

export interface SandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  executionTimeMs: number;
  error?: string;
  timedOut?: boolean;
  memoryExceeded?: boolean;
}

// Default images for different languages
const DEFAULT_IMAGES: Record<string, string> = {
  python: 'python:3.11-slim',
  javascript: 'node:20-slim',
  node: 'node:20-slim',
  shell: 'alpine:latest',
  bash: 'alpine:latest',
};

// Default configuration
const DEFAULT_CONFIG: Required<SandboxConfig> = {
  image: 'python:3.11-slim',
  timeout: 30000,
  memoryMB: 256,
  cpus: 1,
  networkEnabled: false,
  workDir: '/sandbox',
  env: {},
  relaxedSecurity: false,
};

let dockerAvailable: boolean | null = null;
let dockerCheckPromise: Promise<boolean> | null = null;
let securityFlagsSupported: boolean | null = null;
let lastHealthCheck: SandboxHealthStatus | null = null;

/**
 * Sandbox health status for diagnostics
 */
export interface SandboxHealthStatus {
  dockerAvailable: boolean;
  dockerVersion: string | null;
  securityFlagsSupported: boolean;
  relaxedSecurityRequired: boolean;
  imagesAvailable: Record<string, boolean>;
  lastChecked: string;
  error?: string;
}

/**
 * Check if Docker is available and running
 */
export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailable !== null) {
    return dockerAvailable;
  }

  // Deduplicate concurrent checks — only one Docker probe runs at a time
  if (dockerCheckPromise) {
    return dockerCheckPromise;
  }

  dockerCheckPromise = (async () => {
    try {
      await execAsync('docker info', { timeout: 5000 });
      dockerAvailable = true;
      return true;
    } catch {
      dockerAvailable = false;
      return false;
    } finally {
      dockerCheckPromise = null;
    }
  })();

  return dockerCheckPromise;
}

/**
 * Get Docker version
 */
export async function getDockerVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('docker version --format "{{.Server.Version}}"', {
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Test if security flags (--no-new-privileges) are supported
 * Some Docker configurations (Windows, older versions) may not support these
 */
export async function testSecurityFlags(): Promise<boolean> {
  if (securityFlagsSupported !== null) {
    return securityFlagsSupported;
  }

  try {
    // Try running a minimal container with security flags
    await execAsync(
      'docker run --rm --no-new-privileges --cap-drop=ALL --security-opt=no-new-privileges:true alpine:latest echo "test"',
      { timeout: 30000 }
    );
    securityFlagsSupported = true;
    return true;
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    // Check for specific error messages indicating unsupported flags
    if (
      errorMsg.includes('unknown flag') ||
      errorMsg.includes('no-new-privileges') ||
      errorMsg.includes('security-opt') ||
      errorMsg.includes('invalid argument')
    ) {
      log.info('Security flags not supported, using relaxed security mode');
      securityFlagsSupported = false;
      return false;
    }
    // If it's a different error (e.g., no image), try without security flags
    securityFlagsSupported = false;
    return false;
  }
}

/**
 * Comprehensive health check for the sandbox
 */
export async function checkSandboxHealth(): Promise<SandboxHealthStatus> {
  const status: SandboxHealthStatus = {
    dockerAvailable: false,
    dockerVersion: null,
    securityFlagsSupported: false,
    relaxedSecurityRequired: false,
    imagesAvailable: {},
    lastChecked: new Date().toISOString(),
  };

  try {
    // Check Docker availability
    status.dockerAvailable = await isDockerAvailable();

    if (!status.dockerAvailable) {
      status.error = 'Docker is not available. Please install and start Docker.';
      lastHealthCheck = status;
      return status;
    }

    // Get Docker version
    status.dockerVersion = await getDockerVersion();

    // Test security flags
    status.securityFlagsSupported = await testSecurityFlags();
    status.relaxedSecurityRequired = !status.securityFlagsSupported;

    // Check if default images are available
    for (const [lang, image] of Object.entries(DEFAULT_IMAGES)) {
      try {
        const { stdout } = await execAsync(`docker images -q ${image}`, { timeout: 5000 });
        status.imagesAvailable[lang] = !!stdout.trim();
      } catch {
        status.imagesAvailable[lang] = false;
      }
    }

    lastHealthCheck = status;
    return status;
  } catch (error) {
    status.error = getErrorMessage(error, 'Unknown error during health check');
    lastHealthCheck = status;
    return status;
  }
}

/**
 * Get cached health status or perform new check
 */
export async function getSandboxStatus(forceRefresh = false): Promise<SandboxHealthStatus> {
  // Return cached if available and not forcing refresh (cache for 5 minutes)
  if (!forceRefresh && lastHealthCheck) {
    const cacheAge = Date.now() - new Date(lastHealthCheck.lastChecked).getTime();
    if (cacheAge < 5 * 60 * 1000) {
      return lastHealthCheck;
    }
  }
  return checkSandboxHealth();
}

/**
 * Reset cached status (useful after Docker restart)
 */
export function resetSandboxCache(): void {
  dockerAvailable = null;
  securityFlagsSupported = null;
  lastHealthCheck = null;
}

/**
 * Pull a Docker image if not already available
 */
export async function ensureImage(image: string): Promise<boolean> {
  // Validate image name to prevent command injection
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]*$/.test(image) || image.length > 200) {
    log.error(`Invalid Docker image name: ${image.substring(0, 50)}`);
    return false;
  }

  try {
    // Check if image exists locally
    const { stdout } = await execAsync(`docker images -q ${image}`);
    if (stdout.trim()) {
      return true;
    }

    // Pull the image
    log.info(`Pulling Docker image: ${image}`);
    await execAsync(`docker pull ${image}`, { timeout: 300000 }); // 5 min timeout for pull
    return true;
  } catch (error) {
    log.error(`Failed to pull image ${image}:`, error);
    return false;
  }
}

/**
 * Execute code in a Docker sandbox
 */
export async function executeInSandbox(
  code: string,
  language: 'python' | 'javascript' | 'shell',
  config: SandboxConfig = {}
): Promise<SandboxResult> {
  const startTime = Date.now();

  // Check Docker availability
  if (!(await isDockerAvailable())) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      executionTimeMs: Date.now() - startTime,
      error: 'Docker is not available. Please install and start Docker to use sandbox execution.',
    };
  }

  // Auto-detect if relaxed security is needed (only test once)
  let useRelaxedSecurity = config.relaxedSecurity ?? false;
  if (!useRelaxedSecurity && securityFlagsSupported === null) {
    // First run - test security flags
    const flagsSupported = await testSecurityFlags();
    if (!flagsSupported) {
      log.info('Auto-enabling relaxed security mode due to Docker compatibility');
      useRelaxedSecurity = true;
    }
  } else if (!useRelaxedSecurity && securityFlagsSupported === false) {
    // Already tested and not supported
    useRelaxedSecurity = true;
  }

  // Merge config with defaults
  const cfg: Required<SandboxConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
    image: config.image ?? DEFAULT_IMAGES[language] ?? DEFAULT_CONFIG.image,
    relaxedSecurity: useRelaxedSecurity,
  };

  // Ensure image is available
  const imageReady = await ensureImage(cfg.image);
  if (!imageReady) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      executionTimeMs: Date.now() - startTime,
      error: `Failed to prepare Docker image: ${cfg.image}`,
    };
  }

  // Create temp directory for code
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-'));
  const codeFile = path.join(tempDir, getCodeFilename(language));

  try {
    // Write code to temp file
    await fs.writeFile(codeFile, code, 'utf-8');

    // Build Docker command
    const dockerArgs = buildDockerArgs(tempDir, language, cfg);

    // Execute in container
    const result = await runDockerContainer(dockerArgs, cfg.timeout);

    return {
      ...result,
      executionTimeMs: Date.now() - startTime,
    };
  } finally {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get filename for code based on language
 */
function getCodeFilename(language: string): string {
  switch (language) {
    case 'python':
      return 'code.py';
    case 'javascript':
    case 'node':
      return 'code.js';
    case 'shell':
    case 'bash':
      return 'code.sh';
    default:
      return 'code.txt';
  }
}

/**
 * Get command to execute code based on language
 */
function getExecuteCommand(language: string): string[] {
  switch (language) {
    case 'python':
      return ['python', '/sandbox/code.py'];
    case 'javascript':
    case 'node':
      return ['node', '/sandbox/code.js'];
    case 'shell':
    case 'bash':
      return ['sh', '/sandbox/code.sh'];
    default:
      return ['cat', '/sandbox/code.txt'];
  }
}

/**
 * Build Docker run arguments
 */
function buildDockerArgs(
  hostDir: string,
  language: string,
  config: Required<SandboxConfig>
): string[] {
  const args: string[] = [
    'run',
    '--rm', // Remove container after exit
    '--read-only', // Read-only root filesystem
    `--memory=${config.memoryMB}m`, // Memory limit
    `--cpus=${config.cpus}`, // CPU limit
    '--pids-limit=100', // Limit number of processes
    '--hostname=sandbox', // Hide host machine name
    '--user=65534:65534', // Run as nobody (non-root, no privileges)
  ];

  // Add security flags unless relaxedSecurity is enabled
  // Some Docker versions/configurations don't support --no-new-privileges
  if (!config.relaxedSecurity) {
    args.push('--no-new-privileges'); // Prevent privilege escalation
    args.push('--cap-drop=ALL'); // Drop all capabilities
    args.push('--security-opt=no-new-privileges:true');
  } else {
    // Even with relaxed security, drop dangerous capabilities
    args.push('--cap-drop=SYS_ADMIN');
    args.push('--cap-drop=NET_ADMIN');
  }

  // Network isolation
  if (!config.networkEnabled) {
    args.push('--network=none');
  }

  // Mount code directory
  args.push('-v', `${hostDir}:/sandbox:ro`);

  // Set working directory
  args.push('-w', config.workDir);

  // Add environment variables
  for (const [key, value] of Object.entries(config.env)) {
    args.push('-e', `${key}=${value}`);
  }

  // Add image
  args.push(config.image);

  // Add execution command
  args.push(...getExecuteCommand(language));

  return args;
}

/**
 * Run Docker container and capture output
 */
function runDockerContainer(
  args: string[],
  timeout: number
): Promise<Omit<SandboxResult, 'executionTimeMs'>> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    let timedOut = false;

    const child = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Timeout handler
    const timeoutId = setTimeout(() => {
      timedOut = true;
      killed = true;
      child.kill('SIGKILL');
    }, timeout);

    // Capture stdout
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      // Limit output size
      if (stdout.length > 1024 * 1024) {
        stdout = stdout.slice(0, 1024 * 1024) + '\n[Output truncated]';
        killed = true;
        child.kill('SIGKILL');
      }
    });

    // Capture stderr
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 1024 * 1024) {
        stderr = stderr.slice(0, 1024 * 1024) + '\n[Output truncated]';
      }
    });

    // Handle completion
    child.on('close', (exitCode: number | null) => {
      clearTimeout(timeoutId);

      // Check for OOM kill (exit code 137)
      const memoryExceeded = exitCode === 137;

      resolve({
        success: exitCode === 0 && !killed,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        timedOut,
        memoryExceeded,
        error: timedOut
          ? 'Execution timed out'
          : memoryExceeded
            ? 'Memory limit exceeded'
            : undefined,
      });
    });

    // Handle spawn errors
    child.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: `Failed to start container: ${error.message}`,
      });
    });
  });
}

/**
 * Execute Python code in sandbox
 */
export async function executePythonSandbox(
  code: string,
  config?: SandboxConfig
): Promise<SandboxResult> {
  return executeInSandbox(code, 'python', config);
}

/**
 * Execute JavaScript code in sandbox
 */
export async function executeJavaScriptSandbox(
  code: string,
  config?: SandboxConfig
): Promise<SandboxResult> {
  return executeInSandbox(code, 'javascript', config);
}

/**
 * Execute shell script in sandbox
 */
export async function executeShellSandbox(
  code: string,
  config?: SandboxConfig
): Promise<SandboxResult> {
  return executeInSandbox(code, 'shell', config);
}
