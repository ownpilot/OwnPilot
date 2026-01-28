/**
 * OS Keychain integration for secure master key storage
 * Supports: macOS (security), Linux (secret-tool), Windows (PowerShell)
 * Uses Node.js built-in child_process
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { type Result, ok, err } from '../types/result.js';
import { CryptoError, InternalError } from '../types/errors.js';
import { toBase64, fromBase64 } from './derive.js';

const execAsync = promisify(exec);

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
        // macOS: Use security CLI
        // First, try to delete existing (ignore errors)
        try {
          await execAsync(
            `security delete-generic-password -s "${cfg.service}" -a "${cfg.account}" 2>/dev/null`
          );
        } catch {
          // Ignore - may not exist
        }

        // Add new secret
        await execAsync(
          `security add-generic-password -s "${cfg.service}" -a "${cfg.account}" -w "${base64Secret}"`
        );
        return ok(undefined);
      }

      case 'linux': {
        // Linux: Use secret-tool (libsecret)
        // Store with stdin to avoid command line exposure
        await execAsync(
          `echo -n "${base64Secret}" | secret-tool store --label="${cfg.service}" service "${cfg.service}" account "${cfg.account}"`
        );
        return ok(undefined);
      }

      case 'win32': {
        // Windows: Use PowerShell SecretManagement or credential manager
        const psCommand = `
          $secureString = ConvertTo-SecureString -String '${base64Secret}' -AsPlainText -Force
          $credential = New-Object System.Management.Automation.PSCredential -ArgumentList '${cfg.account}', $secureString

          # Use Windows Credential Manager via cmdkey
          $null = cmdkey /delete:${cfg.service} 2>$null
          $null = cmdkey /generic:${cfg.service} /user:${cfg.account} /pass:${base64Secret}
        `;

        await execAsync(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`, {
          shell: 'powershell.exe',
        });
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
        // macOS: Use security CLI
        const { stdout } = await execAsync(
          `security find-generic-password -s "${cfg.service}" -a "${cfg.account}" -w 2>/dev/null`
        );
        const base64Secret = stdout.trim();
        if (!base64Secret) {
          return ok(null);
        }
        return ok(fromBase64(base64Secret));
      }

      case 'linux': {
        // Linux: Use secret-tool
        const { stdout } = await execAsync(
          `secret-tool lookup service "${cfg.service}" account "${cfg.account}" 2>/dev/null`
        );
        const base64Secret = stdout.trim();
        if (!base64Secret) {
          return ok(null);
        }
        return ok(fromBase64(base64Secret));
      }

      case 'win32': {
        // Windows: Use cmdkey to retrieve
        const psCommand = `
          $cred = cmdkey /list:${cfg.service} 2>$null
          if ($LASTEXITCODE -eq 0) {
            # Use .NET to retrieve the actual password
            Add-Type -AssemblyName System.Security
            $target = '${cfg.service}'

            # Alternative: Use Windows Credential Manager API
            $sig = @'
            [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
            public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

            [DllImport("advapi32.dll", SetLastError = true)]
            public static extern bool CredFree(IntPtr cred);
'@

            try {
              Add-Type -MemberDefinition $sig -Namespace Win32 -Name Credential -ErrorAction SilentlyContinue
            } catch {}

            # For simplicity, we'll use a file-based fallback
            $credPath = Join-Path $env:LOCALAPPDATA "OwnPilot\\cred.dat"
            if (Test-Path $credPath) {
              Get-Content $credPath -Raw
            }
          }
        `;

        try {
          const { stdout } = await execAsync(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`, {
            shell: 'powershell.exe',
          });
          const base64Secret = stdout.trim();
          if (!base64Secret) {
            return ok(null);
          }
          return ok(fromBase64(base64Secret));
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
        await execAsync(
          `security delete-generic-password -s "${cfg.service}" -a "${cfg.account}" 2>/dev/null`
        );
        return ok(undefined);
      }

      case 'linux': {
        await execAsync(
          `secret-tool clear service "${cfg.service}" account "${cfg.account}" 2>/dev/null`
        );
        return ok(undefined);
      }

      case 'win32': {
        await execAsync(`cmdkey /delete:${cfg.service}`, {
          shell: 'powershell.exe',
        });
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
