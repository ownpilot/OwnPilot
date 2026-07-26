import {
  RefreshCw,
  Database,
  Upload,
  Download,
  Trash2,
  Wrench,
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from '../components/icons';
import { systemApi } from '../api';
import type { DatabaseStatus, BackupInfo, DatabaseStats } from '../api';
import { safeDownloadHref } from '../utils/safe-url';
import { CSV_TABLES } from './SystemPage.constants';

interface DatabaseTabContentProps {
  databaseStatus: DatabaseStatus | null;
  backups: BackupInfo[];
  dbStats: DatabaseStats | null;
  dbOperationRunning: boolean;
  dbOperationType: string;
  dbOperationOutput: string[];
  dbOperationResult: 'success' | 'failure' | null;
  adminKey: string;
  adminKeyError: string;
  onAdminKeyChange: (key: string) => void;
  onLoadSystemStatus: () => void;
  onCreateBackup: () => void;
  onRunMaintenance: (type: string) => void;
  onRestoreBackup: (filename: string) => void;
  onDeleteBackup: (filename: string) => void;
  onCsvExport: (table: string) => void;
  csvExportLoading: string | null;
  csvImportLoading: boolean;
  csvImportTable: string;
  onCsvImportTableChange: (table: string) => void;
  onCsvImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function DatabaseTabContent({
  databaseStatus,
  backups,
  dbStats,
  dbOperationRunning,
  dbOperationType,
  dbOperationOutput,
  dbOperationResult,
  adminKey,
  adminKeyError,
  onAdminKeyChange,
  onLoadSystemStatus,
  onCreateBackup,
  onRunMaintenance,
  onRestoreBackup,
  onDeleteBackup,
  onCsvExport,
  csvExportLoading,
  csvImportLoading,
  csvImportTable,
  onCsvImportTableChange,
  onCsvImport,
}: DatabaseTabContentProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Title */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              <Database className="w-5 h-5" />
              Database Management
            </h3>
            <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
              PostgreSQL backup, restore, maintenance, and monitoring
            </p>
          </div>
          <button
            onClick={onLoadSystemStatus}
            disabled={databaseStatus === null}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Admin Key Input */}
        <section className="p-4 bg-warning/5 border border-warning/20 rounded-xl">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Admin Key
              </label>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Required for backup, restore, and maintenance operations. Set ADMIN_KEY env var on
                server.
              </p>
            </div>
            <div className="w-64">
              <input
                type="password"
                value={adminKey}
                onChange={(e) => onAdminKeyChange(e.target.value)}
                placeholder="Enter admin key..."
                className={`w-full px-3 py-2 text-sm bg-bg-primary dark:bg-dark-bg-primary border rounded-lg focus:outline-none ${adminKeyError ? 'border-error' : 'border-border dark:border-dark-border focus:border-primary'}`}
              />
              {adminKeyError && <p className="mt-1 text-xs text-error">{adminKeyError}</p>}
            </div>
          </div>
        </section>

        {/* Database Status */}
        <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5" />
            Connection Status
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
                        ? `${dbStats.database.size} • ${dbStats.tables.length} tables • ${dbStats.version}`
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
            </div>
          ) : (
            <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
              <p>Unable to load database status</p>
            </div>
          )}
        </section>

        {/* Backup & Restore */}
        {databaseStatus?.connected && (
          <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
              <Download className="w-5 h-5" />
              Backup & Restore
            </h3>

            <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg space-y-4">
              {/* Actions */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-text-primary dark:text-dark-text-primary">
                    Database Backups
                  </p>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">
                    Create SQL backups or restore from existing backups
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={onCreateBackup}
                    disabled={dbOperationRunning}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                  >
                    {dbOperationRunning && dbOperationType === 'Backup' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Create Backup
                  </button>
                </div>
              </div>

              {/* Backups List */}
              {backups.length > 0 && (
                <div className="border-t border-border dark:border-dark-border pt-4">
                  <p className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-3">
                    Available Backups ({backups.length})
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {backups.map((backup) => {
                      const backupHref = safeDownloadHref(
                        systemApi.downloadBackup(backup.filename)
                      );
                      return (
                        <div
                          key={backup.filename}
                          className="flex items-center justify-between p-3 bg-bg-primary dark:bg-dark-bg-primary rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono text-text-primary dark:text-dark-text-primary truncate">
                              {backup.filename}
                            </p>
                            <p className="text-xs text-text-muted dark:text-dark-text-muted">
                              {backup.sizeHuman} • {backup.type.toUpperCase()} •{' '}
                              {new Date(backup.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex gap-1 ml-2">
                            {backupHref && (
                              <a
                                href={backupHref}
                                download={backup.filename}
                                className="p-2 text-info hover:bg-info/10 rounded-lg transition-colors"
                                title="Download backup"
                                aria-label="Download backup"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            )}
                            <button
                              onClick={() => onRestoreBackup(backup.filename)}
                              disabled={dbOperationRunning}
                              className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                              title="Restore backup"
                              aria-label="Restore backup"
                            >
                              <Upload className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onDeleteBackup(backup.filename)}
                              disabled={dbOperationRunning}
                              className="p-2 text-error hover:bg-error/10 rounded-lg transition-colors disabled:opacity-50"
                              title="Delete backup"
                              aria-label="Delete backup"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {backups.length === 0 && !dbOperationRunning && (
                <div className="border-t border-border dark:border-dark-border pt-4">
                  <div className="p-4 bg-bg-primary dark:bg-dark-bg-primary rounded-lg text-center">
                    <Database className="w-8 h-8 text-text-muted mx-auto mb-2" />
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      No backups available. Create your first backup above.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Maintenance */}
        {databaseStatus?.connected && (
          <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
              <Wrench className="w-5 h-5" />
              Maintenance
            </h3>

            <div className="grid gap-4 md:grid-cols-2">
              {/* VACUUM */}
              <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-text-primary dark:text-dark-text-primary">
                      VACUUM
                    </p>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                      Reclaim storage and optimize table performance
                    </p>
                  </div>
                  <button
                    onClick={() => onRunMaintenance('vacuum')}
                    disabled={dbOperationRunning}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary disabled:opacity-50 transition-colors"
                  >
                    {dbOperationRunning && dbOperationType.includes('vacuum') ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wrench className="w-4 h-4" />
                    )}
                    Run
                  </button>
                </div>
              </div>

              {/* ANALYZE */}
              <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-text-primary dark:text-dark-text-primary">
                      ANALYZE
                    </p>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                      Update statistics for query optimizer
                    </p>
                  </div>
                  <button
                    onClick={() => onRunMaintenance('analyze')}
                    disabled={dbOperationRunning}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary disabled:opacity-50 transition-colors"
                  >
                    {dbOperationRunning && dbOperationType.includes('analyze') ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Activity className="w-4 h-4" />
                    )}
                    Run
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Data Export / Import */}
        {databaseStatus?.connected && (
          <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
              <Download className="w-5 h-5" />
              Data Export & Import
            </h3>

            <div className="grid gap-6 md:grid-cols-2">
              {/* JSON Export/Import */}
              <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg space-y-4">
                <div>
                  <p className="font-medium text-text-primary dark:text-dark-text-primary">
                    Full JSON Export
                  </p>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                    Export all database tables as JSON (includes agents, conversations, settings,
                    and more)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const data = await systemApi.exportJson(undefined, adminKey || undefined);
                        const blob = new Blob([JSON.stringify(data, null, 2)], {
                          type: 'application/json',
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `ownpilot-export-${new Date().toISOString().split('T')[0]}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch {
                        // handled by caller
                      }
                    }}
                    disabled={dbOperationRunning}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export JSON
                  </button>
                </div>

                <div className="border-t border-border dark:border-dark-border pt-3">
                  <p className="font-medium text-text-primary dark:text-dark-text-primary mb-2">
                    Import JSON
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="file"
                      accept=".json"
                      id="json-import"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const text = await file.text();
                          const data = JSON.parse(text);
                          await systemApi.importJson(
                            { data, options: { truncate: false } },
                            undefined,
                            adminKey || undefined
                          );
                          onLoadSystemStatus();
                        } catch {
                          // handled by caller
                        }
                        e.target.value = '';
                      }}
                    />
                    <label
                      htmlFor="json-import"
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg cursor-pointer hover:border-primary transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      Choose JSON
                    </label>
                  </div>
                </div>
              </div>

              {/* CSV Export */}
              <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg space-y-4">
                <div>
                  <p className="font-medium text-text-primary dark:text-dark-text-primary">
                    CSV Export
                  </p>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                    Export user data as CSV (expenses, habits, notes, tasks, contacts, etc.)
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {CSV_TABLES.map((table) => (
                    <button
                      key={table}
                      onClick={() => onCsvExport(table)}
                      disabled={csvExportLoading !== null}
                      className="px-2 py-1 text-xs bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded hover:border-primary transition-colors disabled:opacity-50"
                    >
                      {csvExportLoading === table ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        table
                      )}
                    </button>
                  ))}
                </div>

                <div className="border-t border-border dark:border-dark-border pt-3">
                  <p className="font-medium text-text-primary dark:text-dark-text-primary mb-2">
                    CSV Import
                  </p>
                  <div className="flex gap-2 items-center">
                    <select
                      value={csvImportTable}
                      onChange={(e) => onCsvImportTableChange(e.target.value)}
                      className="px-2 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded"
                    >
                      {CSV_TABLES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      type="file"
                      accept=".csv"
                      id="csv-import"
                      className="hidden"
                      onChange={onCsvImport}
                    />
                    <label
                      htmlFor="csv-import"
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg cursor-pointer hover:border-primary transition-colors disabled:opacity-50"
                    >
                      {csvImportLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      {csvImportLoading ? 'Importing...' : 'Import CSV'}
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Operation Output */}
        {dbOperationOutput.length > 0 && (
          <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4">
              Operation Output
            </h3>
            <div className="p-4 bg-bg-primary dark:bg-dark-bg-primary rounded-lg">
              <pre className="text-xs font-mono text-text-muted dark:text-dark-text-muted whitespace-pre-wrap max-h-48 overflow-y-auto">
                {dbOperationOutput.join('\n')}
              </pre>
            </div>

            {/* Operation Result */}
            {dbOperationResult && (
              <div
                className={`flex items-center gap-2 p-3 mt-4 rounded-lg ${
                  dbOperationResult === 'success'
                    ? 'bg-success/10 text-success'
                    : 'bg-error/10 text-error'
                }`}
              >
                {dbOperationResult === 'success' ? (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">{dbOperationType} completed successfully!</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5" />
                    <span className="font-medium">
                      {dbOperationType} failed. Check output above.
                    </span>
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
