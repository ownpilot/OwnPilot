import {
  Container,
  RefreshCw,
  ShieldCheck,
  Shield,
  XCircle,
  CheckCircle2,
  Settings,
  Terminal,
  Puzzle,
  Server,
  AlertCircle,
} from '../components/icons';
import { useTheme } from '../hooks/useTheme';
import { useDesktopNotifications } from '../hooks/useDesktopNotifications';
import { LoadingSpinner } from '../components/LoadingSpinner';
import type { SandboxStatus } from '../api';
import type { ToolDependenciesResponse } from '../api/endpoints/misc';
import { formatUptime, CATEGORY_COLORS } from './SystemPage.constants';

interface SystemTabContentProps {
  sandboxStatus: SandboxStatus | null;
  toolDeps: ToolDependenciesResponse | null;
  systemVersion: string;
  systemUptime: number;
  isLoadingSystem: boolean;
  isLoadingDeps: boolean;
  onLoadSystemStatus: () => void;
  onLoadToolDependencies: () => void;
  depsByCategory: Array<
    [
      string,
      Array<{
        package: string;
        installed: boolean;
        version: string | null;
        description: string;
        tools: string[];
        type?: string;
        category: string;
      }>,
    ]
  >;
}

export function SystemTabContent({
  sandboxStatus,
  toolDeps,
  systemVersion,
  systemUptime,
  isLoadingSystem,
  isLoadingDeps,
  onLoadSystemStatus,
  onLoadToolDependencies,
  depsByCategory,
}: SystemTabContentProps) {
  const { theme, setTheme } = useTheme();
  const {
    supported: notifSupported,
    permission: notifPermission,
    enabled: notifEnabled,
    setEnabled: setNotifEnabled,
    requestPermission,
  } = useDesktopNotifications();

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="space-y-6">
        {/* Appearance */}
        <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Appearance
          </h3>
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Theme
            </label>
            <div className="flex gap-2">
              {(['system', 'light', 'dark', 'claude'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setTheme(option)}
                  className={`px-4 py-2 rounded-lg capitalize transition-colors ${
                    theme === option
                      ? 'bg-primary text-white'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {/* Desktop Notifications */}
          {notifSupported && (
            <div className="mt-6 pt-6 border-t border-border dark:border-dark-border">
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Desktop Notifications
              </label>
              <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                <div>
                  <p className="text-sm text-text-primary dark:text-dark-text-primary">
                    Show notifications for incoming messages and trigger failures
                  </p>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                    {notifPermission === 'granted'
                      ? 'Notifications are allowed by your browser'
                      : notifPermission === 'denied'
                        ? 'Notifications are blocked. Enable them in browser settings.'
                        : 'Browser permission required'}
                  </p>
                </div>
                {notifPermission === 'granted' ? (
                  <button
                    onClick={() => setNotifEnabled(!notifEnabled)}
                    className={`w-10 h-6 rounded-full transition-colors relative ${
                      notifEnabled ? 'bg-primary' : 'bg-border dark:bg-dark-border'
                    }`}
                    aria-label={notifEnabled ? 'Disable notifications' : 'Enable notifications'}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                        notifEnabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                ) : notifPermission !== 'denied' ? (
                  <button
                    onClick={requestPermission}
                    className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                  >
                    Enable
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>

        {/* Tool Dependencies */}
        <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              <Puzzle className="w-5 h-5" />
              Tool Dependencies
            </h3>
            <div className="flex items-center gap-3">
              {toolDeps && (
                <span className="text-sm text-text-muted dark:text-dark-text-muted">
                  {toolDeps.summary.packagesInstalled}/{toolDeps.summary.packagesTotal} packages
                  {' + '}
                  {toolDeps.summary.cliInstalled}/{toolDeps.summary.cliTotal} CLI tools
                </span>
              )}
              <button
                onClick={onLoadToolDependencies}
                disabled={isLoadingDeps}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingDeps ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {isLoadingDeps && !toolDeps ? (
            <div className="py-4">
              <LoadingSpinner size="sm" />
            </div>
          ) : toolDeps ? (
            <div className="space-y-4">
              {depsByCategory.map(([category, deps]) => (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${CATEGORY_COLORS[category] ?? 'bg-gray-500/10 text-text-muted dark:text-dark-text-muted'}`}
                    >
                      {category}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {deps.map((dep) => (
                      <div
                        key={dep.package}
                        className="flex items-center justify-between p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {dep.installed ? (
                            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-error shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-sm text-text-primary dark:text-dark-text-primary">
                                {dep.package}
                              </p>
                              {dep.type === 'cli' && (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-500/10 text-text-muted dark:text-dark-text-muted rounded">
                                  CLI
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                              {dep.description}
                              {dep.tools.length > 0 && (
                                <span className="ml-1 opacity-70">({dep.tools.join(', ')})</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-mono shrink-0 ml-2 ${dep.installed ? 'text-success' : 'text-error'}`}
                        >
                          {dep.installed
                            ? dep.version
                              ? `v${dep.version}`
                              : 'Installed'
                            : 'Missing'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Missing packages warning */}
              {(toolDeps.summary.packagesInstalled < toolDeps.summary.packagesTotal ||
                toolDeps.summary.cliInstalled < toolDeps.summary.cliTotal) && (
                <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-warning">Some dependencies are missing</p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                        Missing npm packages can be installed with{' '}
                        <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">
                          pnpm install
                        </code>
                        . Missing CLI tools must be installed globally on the host system.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
              <p>Unable to load tool dependencies</p>
            </div>
          )}
        </section>

        {/* Docker Sandbox Status */}
        <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              <Container className="w-5 h-5" />
              Docker Sandbox Status
            </h3>
            <button
              onClick={onLoadSystemStatus}
              disabled={isLoadingSystem}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingSystem ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {isLoadingSystem ? (
            <div className="py-4">
              <LoadingSpinner size="sm" />
            </div>
          ) : sandboxStatus ? (
            <div className="space-y-4">
              {/* Docker Available */}
              <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                <div className="flex items-center gap-3">
                  {sandboxStatus.dockerAvailable ? (
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  ) : (
                    <XCircle className="w-5 h-5 text-error" />
                  )}
                  <div>
                    <p className="font-medium text-text-primary dark:text-dark-text-primary">
                      Docker
                    </p>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      Container runtime for code isolation
                    </p>
                  </div>
                </div>
                <span
                  className={`text-sm font-medium ${sandboxStatus.dockerAvailable ? 'text-success' : 'text-error'}`}
                >
                  {sandboxStatus.dockerAvailable ? 'Available' : 'Not Available'}
                </span>
              </div>

              {/* Docker Version */}
              {sandboxStatus.dockerAvailable && sandboxStatus.dockerVersion && (
                <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-info" />
                    <div>
                      <p className="font-medium text-text-primary dark:text-dark-text-primary">
                        Docker Version
                      </p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted">
                        Installed Docker engine version
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-mono text-text-secondary dark:text-dark-text-secondary">
                    v{sandboxStatus.dockerVersion}
                  </span>
                </div>
              )}

              {/* Code Execution */}
              <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                <div className="flex items-center gap-3">
                  {sandboxStatus.codeExecutionEnabled ? (
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  ) : (
                    <XCircle className="w-5 h-5 text-error" />
                  )}
                  <div>
                    <p className="font-medium text-text-primary dark:text-dark-text-primary">
                      Code Execution
                    </p>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      {sandboxStatus.dockerAvailable
                        ? 'Python, JavaScript, Shell execution in Docker sandbox'
                        : sandboxStatus.codeExecutionEnabled
                          ? 'Python, JavaScript, Shell execution on host (local mode)'
                          : 'Code execution disabled (Docker required)'}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-sm font-medium ${sandboxStatus.codeExecutionEnabled ? 'text-success' : 'text-error'}`}
                >
                  {sandboxStatus.codeExecutionEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              {/* Execution Mode */}
              {sandboxStatus.executionMode && (
                <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                  <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-info" />
                    <div>
                      <p className="font-medium text-text-primary dark:text-dark-text-primary">
                        Execution Mode
                      </p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted">
                        {sandboxStatus.executionMode === 'docker'
                          ? 'Docker only (most secure, requires Docker)'
                          : sandboxStatus.executionMode === 'local'
                            ? 'Local execution (runs on host, no Docker needed)'
                            : 'Auto (Docker preferred, local fallback)'}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary font-mono">
                    {sandboxStatus.executionMode}
                  </span>
                </div>
              )}

              {/* Security Mode */}
              <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                <div className="flex items-center gap-3">
                  {sandboxStatus.securityMode === 'strict' ? (
                    <ShieldCheck className="w-5 h-5 text-success" />
                  ) : sandboxStatus.securityMode === 'local' ? (
                    <Shield className="w-5 h-5 text-info" />
                  ) : (
                    <Shield className="w-5 h-5 text-warning" />
                  )}
                  <div>
                    <p className="font-medium text-text-primary dark:text-dark-text-primary">
                      Security Mode
                    </p>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      {sandboxStatus.securityMode === 'strict'
                        ? 'Full Docker isolation with --no-new-privileges'
                        : sandboxStatus.securityMode === 'local'
                          ? 'Local execution with timeout, output limits, and env sanitization'
                          : sandboxStatus.securityMode === 'disabled'
                            ? 'Code execution disabled'
                            : 'Relaxed Docker mode (some flags disabled)'}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-sm font-medium ${
                    sandboxStatus.securityMode === 'strict'
                      ? 'text-success'
                      : sandboxStatus.securityMode === 'local'
                        ? 'text-info'
                        : sandboxStatus.securityMode === 'disabled'
                          ? 'text-error'
                          : 'text-warning'
                  }`}
                >
                  {sandboxStatus.securityMode === 'strict'
                    ? 'Strict'
                    : sandboxStatus.securityMode === 'local'
                      ? 'Local'
                      : sandboxStatus.securityMode === 'disabled'
                        ? 'Disabled'
                        : 'Relaxed'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
              <p>Unable to load sandbox status</p>
            </div>
          )}

          {/* Docker Not Available — info message */}
          {sandboxStatus && !sandboxStatus.dockerAvailable && (
            <div
              className={`mt-4 p-4 rounded-lg ${
                sandboxStatus.codeExecutionEnabled
                  ? 'bg-info/10 border border-info/20'
                  : 'bg-error/10 border border-error/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  className={`w-5 h-5 shrink-0 mt-0.5 ${
                    sandboxStatus.codeExecutionEnabled ? 'text-info' : 'text-error'
                  }`}
                />
                <div>
                  {sandboxStatus.codeExecutionEnabled ? (
                    <>
                      <p className="font-medium text-info">Running Without Docker</p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                        Code execution is running locally on the host machine. Security measures
                        include timeout enforcement, output limits, command blocking, and
                        environment sanitization. For full isolation, install Docker.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-error">Docker Required for Code Execution</p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                        Code execution is disabled because EXECUTION_MODE=docker but Docker is not
                        available. Set EXECUTION_MODE=auto or EXECUTION_MODE=local to enable local
                        execution without Docker.
                      </p>
                    </>
                  )}
                  <a
                    href="https://docs.docker.com/get-docker/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
                  >
                    Install Docker
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* System Information */}
        <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4">
            System Information
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
              <p className="text-sm text-text-muted dark:text-dark-text-muted">Version</p>
              <p className="font-mono text-text-primary dark:text-dark-text-primary">
                {systemVersion || 'Unknown'}
              </p>
            </div>
            <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
              <p className="text-sm text-text-muted dark:text-dark-text-muted">Uptime</p>
              <p className="font-mono text-text-primary dark:text-dark-text-primary">
                {systemUptime > 0 ? formatUptime(systemUptime) : 'Unknown'}
              </p>
            </div>
          </div>
        </section>

        {/* Security Information */}
        <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Sandbox Security
          </h3>
          <div className="space-y-3 text-sm text-text-muted dark:text-dark-text-muted">
            <p>
              <strong className="text-text-secondary dark:text-dark-text-secondary">
                Network Isolation:
              </strong>{' '}
              Code runs with{' '}
              <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">
                --network=none
              </code>
              , preventing all network access
            </p>
            <p>
              <strong className="text-text-secondary dark:text-dark-text-secondary">
                Resource Limits:
              </strong>{' '}
              Memory (256MB), CPU (1 core), processes (100 max), execution time (30s)
            </p>
            <p>
              <strong className="text-text-secondary dark:text-dark-text-secondary">
                Filesystem:
              </strong>{' '}
              Read-only root filesystem with isolated{' '}
              <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">/sandbox</code>{' '}
              directory
            </p>
            <p>
              <strong className="text-text-secondary dark:text-dark-text-secondary">
                User Isolation:
              </strong>{' '}
              Runs as nobody user (UID 65534) with no host information leakage
            </p>
            <p>
              <strong className="text-text-secondary dark:text-dark-text-secondary">
                Capabilities:
              </strong>{' '}
              All Linux capabilities dropped, privilege escalation blocked
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
