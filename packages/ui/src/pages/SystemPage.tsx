import { useState, useEffect, useRef } from 'react';
import {
  Container,
  RefreshCw,
  ShieldCheck,
  Shield,
  XCircle,
  CheckCircle2,
  Database,
  Upload,
  Download,
  Trash2,
  Wrench,
  Server,
  AlertCircle,
  Settings,
  Terminal,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useTheme } from '../hooks/useTheme';
import { useDesktopNotifications } from '../hooks/useDesktopNotifications';
import { systemApi } from '../api';
import type { SandboxStatus, DatabaseStatus, BackupInfo, DatabaseStats } from '../api';

// Helper to format uptime
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function SystemPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  // Theme
  const { theme, setTheme } = useTheme();
  const {
    supported: notifSupported,
    permission: notifPermission,
    enabled: notifEnabled,
    setEnabled: setNotifEnabled,
    requestPermission,
  } = useDesktopNotifications();

  // System status
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(null);
  const [systemVersion, setSystemVersion] = useState<string>('');
  const [systemUptime, setSystemUptime] = useState<number>(0);
  const [isLoadingSystem, setIsLoadingSystem] = useState(false);

  // Database operations state
  const [dbOperationRunning, setDbOperationRunning] = useState(false);
  const [dbOperationType, setDbOperationType] = useState<string>('');
  const [dbOperationOutput, setDbOperationOutput] = useState<string[]>([]);
  const [dbOperationResult, setDbOperationResult] = useState<'success' | 'failure' | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);

  // Track active poll timers for cleanup
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Load system status on mount
  useEffect(() => {
    loadSystemStatus();
  }, []);

  const loadSystemStatus = async () => {
    setIsLoadingSystem(true);
    try {
      const [healthData, dbStatusData, statsData] = await Promise.all([
        systemApi.health(),
        systemApi.databaseStatus(),
        systemApi.databaseStats().catch(() => null),
      ]);

      setSandboxStatus(healthData.sandbox ?? null);
      setDatabaseStatus(healthData.database ?? null);
      setSystemVersion(healthData.version);
      setSystemUptime(healthData.uptime);

      setBackups(dbStatusData.backups || []);

      if (statsData) {
        setDbStats(statsData);
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoadingSystem(false);
    }
  };

  // Generic database operation handler
  const runDbOperation = async (
    endpoint: string,
    operationType: string,
    body: Record<string, unknown> = {}
  ) => {
    setDbOperationRunning(true);
    setDbOperationType(operationType);
    setDbOperationOutput([]);
    setDbOperationResult(null);

    try {
      await systemApi.databaseOperation(endpoint, body);
      setDbOperationOutput([`${operationType} started...`]);

      // Poll for status — uses ref-based cancellation for unmount safety
      const pollStatus = async () => {
        if (cancelledRef.current) return;
        try {
          const statusData = await systemApi.databaseOperationStatus();
          if (cancelledRef.current) return;

          setDbOperationOutput(statusData.output || []);

          if (!statusData.isRunning) {
            setDbOperationResult((statusData.lastResult as 'success' | 'failure') || 'failure');
            setDbOperationRunning(false);
            loadSystemStatus(); // Refresh
            return;
          }

          pollTimerRef.current = setTimeout(pollStatus, 1000);
        } catch {
          if (!cancelledRef.current) {
            setDbOperationResult('failure');
            setDbOperationRunning(false);
          }
        }
      };

      pollTimerRef.current = setTimeout(pollStatus, 1000);
    } catch {
      setDbOperationOutput([`Failed to start ${operationType.toLowerCase()}`]);
      setDbOperationResult('failure');
      setDbOperationRunning(false);
    }
  };

  const createBackup = () => runDbOperation('backup', 'Backup', { format: 'sql' });
  const runMaintenance = (type: string) =>
    runDbOperation('maintenance', `Maintenance (${type})`, { type });
  const restoreBackup = (filename: string) => runDbOperation('restore', 'Restore', { filename });

  const deleteBackup = async (filename: string) => {
    if (!(await confirm({ message: `Delete backup "${filename}"?`, variant: 'danger' }))) return;

    try {
      await systemApi.deleteBackup(filename);
      toast.success('Backup deleted');
      loadSystemStatus();
    } catch {
      toast.error('Failed to delete backup');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 pt-4 pb-4 border-b border-border dark:border-dark-border">
        <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          System
        </h2>
        <p className="text-sm text-text-muted dark:text-dark-text-muted">
          Appearance, Docker sandbox, database management, and system info
        </p>
      </header>
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
                {(['system', 'light', 'dark'] as const).map((option) => (
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

          {/* Docker Sandbox Status */}
          <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                <Container className="w-5 h-5" />
                Docker Sandbox Status
              </h3>
              <button
                onClick={loadSystemStatus}
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

            {/* Docker Not Available — info message depending on execution mode */}
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
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
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

          {/* Database Status */}
          <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
              <Database className="w-5 h-5" />
              Database
            </h3>

            {databaseStatus ? (
              <div className="space-y-4">
                {/* Database Type & Stats */}
                <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                  <div className="flex items-center gap-3">
                    <Database className="w-5 h-5 text-info" />
                    <div>
                      <p className="font-medium text-text-primary dark:text-dark-text-primary">
                        PostgreSQL Database
                      </p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted">
                        {dbStats
                          ? `${dbStats.database.size} • ${dbStats.tables.length} tables`
                          : 'Production-ready relational database'}
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 text-sm font-medium rounded-full bg-info/10 text-info">
                    PostgreSQL
                  </span>
                </div>

                {/* Connection Status */}
                <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                  <div className="flex items-center gap-3">
                    {databaseStatus.connected ? (
                      <CheckCircle2 className="w-5 h-5 text-success" />
                    ) : (
                      <XCircle className="w-5 h-5 text-error" />
                    )}
                    <div>
                      <p className="font-medium text-text-primary dark:text-dark-text-primary">
                        Connection Status
                      </p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted">
                        {databaseStatus.host ? `Host: ${databaseStatus.host}` : 'Connecting...'}
                        {dbStats &&
                          ` • ${dbStats.connections.active}/${dbStats.connections.max} connections`}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-sm font-medium ${databaseStatus.connected ? 'text-success' : 'text-error'}`}
                  >
                    {databaseStatus.connected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>

                {/* Connection Help */}
                {!databaseStatus.connected && (
                  <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-warning">Database Not Connected</p>
                        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                          Make sure PostgreSQL is running and configured correctly.
                        </p>
                        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-2">
                          Start PostgreSQL with:{' '}
                          <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">
                            docker compose -f docker-compose.db.yml up -d
                          </code>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Backup & Maintenance */}
                {databaseStatus.connected && (
                  <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Download className="w-5 h-5 text-primary" />
                        <div>
                          <p className="font-medium text-text-primary dark:text-dark-text-primary">
                            Backup & Maintenance
                          </p>
                          <p className="text-sm text-text-muted dark:text-dark-text-muted">
                            Create backups and optimize database
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={createBackup}
                          disabled={dbOperationRunning}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                        >
                          {dbOperationRunning && dbOperationType === 'Backup' ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                          Backup
                        </button>
                        <button
                          onClick={() => runMaintenance('vacuum')}
                          disabled={dbOperationRunning}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary disabled:opacity-50 transition-colors"
                          title="VACUUM - reclaim storage"
                        >
                          {dbOperationRunning && dbOperationType.includes('vacuum') ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Wrench className="w-4 h-4" />
                          )}
                          Optimize
                        </button>
                      </div>
                    </div>

                    {/* Backups List */}
                    {backups.length > 0 && (
                      <div className="border-t border-border dark:border-dark-border pt-4">
                        <p className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                          Available Backups ({backups.length})
                        </p>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {backups.map((backup) => (
                            <div
                              key={backup.name}
                              className="flex items-center justify-between p-2 bg-bg-primary dark:bg-dark-bg-primary rounded-lg"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-mono text-text-primary dark:text-dark-text-primary truncate">
                                  {backup.name}
                                </p>
                                <p className="text-xs text-text-muted dark:text-dark-text-muted">
                                  {formatSize(backup.size)} •{' '}
                                  {new Date(backup.created).toLocaleString()}
                                </p>
                              </div>
                              <div className="flex gap-1 ml-2">
                                <button
                                  onClick={() => restoreBackup(backup.name)}
                                  disabled={dbOperationRunning}
                                  className="p-1.5 text-primary hover:bg-primary/10 rounded disabled:opacity-50"
                                  title="Restore this backup"
                                >
                                  <Upload className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => deleteBackup(backup.name)}
                                  disabled={dbOperationRunning}
                                  className="p-1.5 text-error hover:bg-error/10 rounded disabled:opacity-50"
                                  title="Delete this backup"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Operation Output */}
                    {dbOperationOutput.length > 0 && (
                      <div className="border-t border-border dark:border-dark-border pt-4">
                        <div className="p-3 bg-bg-primary dark:bg-dark-bg-primary rounded-lg max-h-32 overflow-y-auto">
                          <pre className="text-xs font-mono text-text-muted dark:text-dark-text-muted whitespace-pre-wrap">
                            {dbOperationOutput.join('\n')}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* Operation Result */}
                    {dbOperationResult && (
                      <div
                        className={`flex items-center gap-2 p-3 rounded-lg ${
                          dbOperationResult === 'success'
                            ? 'bg-success/10 text-success'
                            : 'bg-error/10 text-error'
                        }`}
                      >
                        {dbOperationResult === 'success' ? (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-sm font-medium">
                              {dbOperationType} completed successfully!
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4" />
                            <span className="text-sm font-medium">
                              {dbOperationType} failed. Check output above.
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
                <p>Unable to load database status</p>
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
                <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">
                  /sandbox
                </code>{' '}
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
    </div>
  );
}
