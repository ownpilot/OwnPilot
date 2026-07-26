import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Database, Server, Activity, HardDrive, Home } from '../components/icons';
import { useToast } from '../components/ToastProvider';
import { useSkipHome } from '../hooks/useSkipHome';
import { systemApi } from '../api';
import type { SandboxStatus, DatabaseStatus, BackupInfo, DatabaseStats } from '../api';
import type { ToolDependenciesResponse } from '../api/endpoints/misc';
import { PageHomeTab } from '../components/PageHomeTab';
import { SystemTabContent } from './SystemTabContent';
import { DatabaseTabContent } from './DatabaseTabContent';

export function SystemPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  type TabId = 'home' | 'system' | 'database';
  const TAB_LABELS: Record<TabId, string> = {
    home: 'Home',
    system: 'System',
    database: 'Database',
  };

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && (['home', 'system', 'database'] as string[]).includes(tabParam) ? tabParam : 'home';
  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  // Skip home preference
  const { skipHome, onSkipHomeChange } = useSkipHome({
    pageName: 'system',
    defaultTab: 'system',
  });

  // System status
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(null);
  const [systemVersion, setSystemVersion] = useState<string>('');
  const [systemUptime, setSystemUptime] = useState<number>(0);
  const [isLoadingSystem, setIsLoadingSystem] = useState(false);

  // Tool dependencies
  const [toolDeps, setToolDeps] = useState<ToolDependenciesResponse | null>(null);
  const [isLoadingDeps, setIsLoadingDeps] = useState(false);

  // Database operations state
  const [dbOperationRunning, setDbOperationRunning] = useState(false);
  const [dbOperationType, setDbOperationType] = useState<string>('');
  const [dbOperationOutput, setDbOperationOutput] = useState<string[]>([]);
  const [dbOperationResult, setDbOperationResult] = useState<'success' | 'failure' | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [adminKey, setAdminKey] = useState<string>('');
  const [adminKeyError, setAdminKeyError] = useState<string>('');

  // Validate admin key on change
  useEffect(() => {
    if (adminKey.length === 0) {
      setAdminKeyError('');
    } else if (adminKey.length < 32) {
      setAdminKeyError('Key must be at least 32 characters');
    } else {
      setAdminKeyError('');
    }
  }, [adminKey]);

  // CSV operation states
  const [csvExportLoading, setCsvExportLoading] = useState<string | null>(null);
  const [csvImportLoading, setCsvImportLoading] = useState(false);
  const [csvImportTable, setCsvImportTable] = useState<string>('expenses');

  // Load system status on mount
  useEffect(() => {
    loadSystemStatus();
    loadToolDependencies();
  }, []);

  const loadSystemStatus = async () => {
    setIsLoadingSystem(true);
    try {
      const [healthData, , statsData, backupsData] = await Promise.all([
        systemApi.health(),
        systemApi.databaseStatus(),
        systemApi.databaseStats().catch(() => null),
        systemApi.listBackups().catch(() => null),
      ]);

      setSandboxStatus(healthData.sandbox ?? null);
      setDatabaseStatus(healthData.database ?? null);
      setSystemVersion(healthData.version);
      setSystemUptime(healthData.uptime);

      setBackups(backupsData?.backups || []);

      if (statsData) {
        setDbStats(statsData);
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoadingSystem(false);
    }
  };

  const loadToolDependencies = async () => {
    setIsLoadingDeps(true);
    try {
      const data = await systemApi.toolDependencies();
      setToolDeps(data);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoadingDeps(false);
    }
  };

  // CSV export handler
  const handleCsvExport = async (table: string) => {
    setCsvExportLoading(table);
    try {
      const csv = await systemApi.exportCsvTable(table, adminKey || undefined);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ownpilot-${table}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${table} exported`);
    } catch {
      toast.error(`Export failed for ${table}`);
    } finally {
      setCsvExportLoading(null);
    }
  };

  // CSV import handler
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvImportLoading(true);
    try {
      const text = await file.text();
      const result = await systemApi.importCsv(csvImportTable, text, adminKey || undefined);
      toast.success(`Imported ${result.imported} rows`);
      loadSystemStatus();
    } catch {
      toast.error('CSV import failed');
    } finally {
      setCsvImportLoading(false);
      e.target.value = '';
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
      await systemApi.databaseOperation(endpoint, body, adminKey || undefined);
      setDbOperationOutput([`${operationType} started...`]);
      loadSystemStatus();
    } catch {
      setDbOperationOutput([`Failed to start ${operationType.toLowerCase()}`]);
      setDbOperationResult('failure');
    } finally {
      setDbOperationRunning(false);
    }
  };

  const createBackup = () => runDbOperation('backup', 'Backup', { format: 'sql' });
  const runMaintenance = (type: string) =>
    runDbOperation('maintenance', `Maintenance (${type})`, { type });

  // Group tool deps by category
  const depsByCategory = toolDeps
    ? Object.entries(
        [...toolDeps.packages, ...toolDeps.cliTools].reduce(
          (acc, dep) => {
            (acc[dep.category] ??= []).push(dep);
            return acc;
          },
          {} as Record<string, typeof toolDeps.packages>
        )
      )
    : [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            System
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Appearance, tool dependencies, Docker sandbox, database management, and system info
          </p>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'system', 'database'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {tab === 'database' && <Database className="w-3.5 h-3.5" />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'home' && (
        <PageHomeTab
          heroIcons={[
            { icon: Server, color: 'text-primary bg-primary/10' },
            { icon: Activity, color: 'text-emerald-500 bg-emerald-500/10' },
            { icon: HardDrive, color: 'text-violet-500 bg-violet-500/10' },
          ]}
          title="System Health & Monitoring"
          subtitle="Monitor server health, database connections, memory usage, and service status — your system dashboard at a glance."
          cta={{
            label: 'View System Status',
            icon: Server,
            onClick: () => setTab('system'),
          }}
          skipHomeChecked={skipHome}
          onSkipHomeChange={onSkipHomeChange}
          skipHomeLabel="Skip this screen and go directly to System"
          features={[
            {
              icon: Activity,
              color: 'text-primary bg-primary/10',
              title: 'Health Checks',
              description: 'Real-time health monitoring for all system components.',
            },
            {
              icon: Database,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Database Status',
              description: 'Monitor database connections, backups, and maintenance.',
            },
            {
              icon: HardDrive,
              color: 'text-violet-500 bg-violet-500/10',
              title: 'Memory Usage',
              description: 'Track memory consumption and resource utilization.',
            },
            {
              icon: Server,
              color: 'text-amber-500 bg-amber-500/10',
              title: 'Service Monitor',
              description: 'Check sandbox status, tool dependencies, and uptime.',
            },
          ]}
          steps={[
            {
              title: 'Check system status',
              detail: 'View overall health and version information.',
            },
            {
              title: 'Review health indicators',
              detail: 'Check database, sandbox, and service status.',
            },
            {
              title: 'Monitor resource usage',
              detail: 'Track memory, uptime, and database statistics.',
            },
            { title: 'Set up alerts', detail: 'Configure notifications for system events.' },
          ]}
        />
      )}

      {activeTab === 'system' && (
        <SystemTabContent
          sandboxStatus={sandboxStatus}
          toolDeps={toolDeps}
          systemVersion={systemVersion}
          systemUptime={systemUptime}
          isLoadingSystem={isLoadingSystem}
          isLoadingDeps={isLoadingDeps}
          onLoadSystemStatus={loadSystemStatus}
          onLoadToolDependencies={loadToolDependencies}
          depsByCategory={depsByCategory}
        />
      )}

      {activeTab === 'database' && (
        <DatabaseTabContent
          databaseStatus={databaseStatus}
          backups={backups}
          dbStats={dbStats}
          dbOperationRunning={dbOperationRunning}
          dbOperationType={dbOperationType}
          dbOperationOutput={dbOperationOutput}
          dbOperationResult={dbOperationResult}
          adminKey={adminKey}
          adminKeyError={adminKeyError}
          onAdminKeyChange={setAdminKey}
          onLoadSystemStatus={loadSystemStatus}
          onCreateBackup={createBackup}
          onRunMaintenance={runMaintenance}
          onRestoreBackup={() => {}}
          onDeleteBackup={() => {}}
          onCsvExport={handleCsvExport}
          csvExportLoading={csvExportLoading}
          csvImportLoading={csvImportLoading}
          csvImportTable={csvImportTable}
          onCsvImportTableChange={setCsvImportTable}
          onCsvImport={handleCsvImport}
        />
      )}
    </div>
  );
}
