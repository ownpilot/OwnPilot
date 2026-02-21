/**
 * OS Keychain integration for secure master key storage
 * Supports: macOS (security), Linux (secret-tool), Windows (PowerShell)
 * Uses Node.js built-in child_process
 */

import { exec, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { type Result, ok, err } from '../types/result.js';
import { CryptoError, InternalError } from '../types/errors.js';
import { toBase64, fromBase64 } from './derive.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Run a command with arguments as array — no shell interpolation */
function spawnAsync(cmd: string, args: string[], options?: { input?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command exited with code ${code}: ${stderr}`));
    });
    if (options?.input) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}

/**
 * Keychain configuration
 */
export interface KeychainConfig {
  /** Service name (default: "ownpilot") */
  service: string;
  /** Account name (default: "ownpilot") */
  account: string;
}

const DEFAULT_CONFIG: KeychainConfig = {
  service: 'ownpilot',
  account: 'ownpilot',
};

/**
 * Detected OS platform
 */
export type Platform = 'darwin' | 'linux' | 'win32' | 'unsupported';

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  const os = platform();
  if (os === 'darwin' || os === 'linux' || os === 'win32') {
    return os;
  }
  return 'unsupported';
}

/**
 * Check if keychain is available on this platform
 */
export async function isKeychainAvailable(): Promise<boolean> {
  const os = getPlatform();

  try {
    switch (os) {
      case 'darwin':
        await execAsync('which security');
        return true;
      case 'linux':
        await execAsync('which secret-tool');
        return true;
      case 'win32':
        // PowerShell is always available on Windows
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Store a secret in the OS keychain
 *
 * @param secret - The secret to store (as Uint8Array)
 * @param config - Keychain configuration
 */
export async function storeSecret(
  secret: Uint8Array,
  config: Partial<KeychainConfig> = {}
): Promise<Result<void, CryptoError | InternalError>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const os = getPlatform();
  const base64Secret = toBase64(secret);

  try {
    switch (os) {
      case 'darwin': {
        // macOS: Use security CLI with array args (no shell interpolation)
        try {
          await execFileAsync('security', [
            'delete-generic-password', '-s', cfg.service, '-a', cfg.account,
          ]);
        } catch {
          // Ignore - may not exist
        }

        await execFileAsync('security', [
          'add-generic-password', '-s', cfg.service, '-a', cfg.account, '-w', base64Secret,
        ]);
        return ok(undefined);
      }

      case 'linux': {
        // Linux: Use secret-tool with stdin for the secret value
        await spawnAsync('secret-tool', [
          'store', '--label', cfg.service, 'service', cfg.service, 'account', cfg.account,
        ], { input: base64Secret });
        return ok(undefined);
      }

      case 'win32': {
        // Windows: Write to DPAPI-protected file (cmdkey cannot retrieve passwords)
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const credDir = `${process.env.LOCALAPPDATA || ''}\\OwnPilot`;
        mkdirSync(credDir, { recursive: true });
        const credPath = `${credDir}\\cred.dat`;
        // Use PowerShell DPAPI to encrypt before writing — pass value via stdin to avoid shell injection
        try {
          const script = `$input = [Console]::In.ReadToEnd(); [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($input),[byte[]]@(),'CurrentUser'))`;
          const { stdout } = await spawnAsync('powershell', ['-NoProfile', '-Command', script], { input: base64Secret });
          writeFileSync(credPath, stdout.trim(), { mode: 0o600 });
        } catch {
          // Fallback: write base64 directly if DPAPI unavailable
          writeFileSync(credPath, base64Secret, { mode: 0o600 });
        }
        return ok(undefined);
      }

      default:
        return err(new InternalError(`Unsupported platform: ${os}`));
    }
  } catch (error) {
    return err(
      new CryptoError('encrypt', `Failed to store secret in keychain: ${error}`, {
        cause: error,
      })
    );
  }
}

/**
 * Retrieve a secret from the OS keychain
 *
 * @param config - Keychain configuration
 * @returns The secret as Uint8Array, or null if not found
 */
export async function retrieveSecret(
  config: Partial<KeychainConfig> = {}
): Promise<Result<Uint8Array | null, CryptoError | InternalError>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const os = getPlatform();

  try {
    switch (os) {
      case 'darwin': {
        // macOS: Use security CLI with array args (no shell interpolation)
        const { stdout } = await execFileAsync('security', [
          'find-generic-password', '-s', cfg.service, '-a', cfg.account, '-w',
        ]);
        const base64Secret = stdout.trim();
        if (!base64Secret) {
          return ok(null);
        }
        return ok(fromBase64(base64Secret));
      }

      case 'linux': {
        // Linux: Use secret-tool with array args
        const { stdout } = await execFileAsync('secret-tool', [
          'lookup', 'service', cfg.service, 'account', cfg.account,
        ]);
        const base64Secret = stdout.trim();
        if (!base64Secret) {
          return ok(null);
        }
        return ok(fromBase64(base64Secret));
      }

      case 'win32': {
        // Windows: Read from DPAPI-protected file
        const credPath = `${process.env.LOCALAPPDATA || ''}\\OwnPilot\\cred.dat`;
        try {
          const { readFileSync } = await import('node:fs');
          const content = readFileSync(credPath, 'utf-8').trim();
          if (!content) return ok(null);
          // Try DPAPI decryption first — pass value via stdin to avoid shell injection
          try {
            const script = `$input = [Console]::In.ReadToEnd(); [System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($input),[byte[]]@(),'CurrentUser'))`;
            const { stdout } = await spawnAsync('powershell', ['-NoProfile', '-Command', script], { input: content });
            const base64Secret = stdout.trim();
            if (!base64Secret) return ok(null);
            return ok(fromBase64(base64Secret));
          } catch {
            // Fallback: treat content as plain base64 (legacy data)
            return ok(fromBase64(content));
          }
        } catch {
          return ok(null);
        }
      }

      default:
        return err(new InternalError(`Unsupported platform: ${os}`));
    }
  } catch (error) {
    // Not found is not an error
    if (String(error).includes('could not be found') || String(error).includes('not found')) {
      return ok(null);
    }
    return err(
      new CryptoError('decrypt', `Failed to retrieve secret from keychain: ${error}`, {
        cause: error,
      })
    );
  }
}

/**
 * Delete a secret from the OS keychain
 *
 * @param config - Keychain configuration
 */
export async function deleteSecret(
  config: Partial<KeychainConfig> = {}
): Promise<Result<void, CryptoError | InternalError>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const os = getPlatform();

  try {
    switch (os) {
      case 'darwin': {
        await execFileAsync('security', [
          'delete-generic-password', '-s', cfg.service, '-a', cfg.account,
        ]);
        return ok(undefined);
      }

      case 'linux': {
        await execFileAsync('secret-tool', [
          'clear', 'service', cfg.service, 'account', cfg.account,
        ]);
        return ok(undefined);
      }

      case 'win32': {
        await execFileAsync('cmdkey', [`/delete:${cfg.service}`]);
        return ok(undefined);
      }

      default:
        return err(new InternalError(`Unsupported platform: ${os}`));
    }
  } catch {
    // Ignore errors (may not exist)
    return ok(undefined);
  }
}

/**
 * Check if a secret exists in the OS keychain
 *
 * @param config - Keychain configuration
 */
export async function hasSecret(config: Partial<KeychainConfig> = {}): Promise<boolean> {
  const result = await retrieveSecret(config);
  return result.ok && result.value !== null;
}
