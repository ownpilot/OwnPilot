import React, { useState, useEffect, useCallback } from 'react';
import { useGateway } from '../../hooks/useWebSocket';
import { useToast } from '../../components/ToastProvider';
import { clawsApi } from '../../api/endpoints/claws';
import type { ClawConfig, ClawDoctorResponse, ClawHistoryEntry } from '../../api/endpoints/claws';
import {
  Activity,
  Settings,
  Puzzle,
  FolderOpen,
  Clock,
  FileText,
  Send,
  Bot,
  Zap,
  Wrench,
  X,
} from '../../components/icons';
import { authedFetch, getStateBadge, inputClass as ic } from './utils';
import {
  OverviewTab,
  SettingsTab,
  SkillsTab,
  HistoryTab,
  AuditTab,
  FilesTab,
  OutputTab,
  ConversationTab,
  DoctorTab,
  type ClawOutputEvent,
  type AuditEntry,
} from './ClawDetailTabs';

type DetailTab =
  | 'overview'
  | 'settings'
  | 'skills'
  | 'files'
  | 'history'
  | 'audit'
  | 'doctor'
  | 'output'
  | 'conversation';

const DETAIL_TABS: {
  id: DetailTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'skills', label: 'Skills', icon: Puzzle },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'audit', label: 'Audit', icon: FileText },
  { id: 'doctor', label: 'Doctor', icon: Wrench },
  { id: 'output', label: 'Output', icon: Send },
  { id: 'conversation', label: 'Chat', icon: Bot },
];

export function ClawManagementPanel({
  claw,
  onClose,
  onUpdate,
}: {
  claw: ClawConfig;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [history, setHistory] = useState<ClawHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [outputFeed, setOutputFeed] = useState<ClawOutputEvent[]>([]);
  const [message, setMessage] = useState('');

  // Skills state
  const [availableSkills, setAvailableSkills] = useState<
    Array<{ id: string; name: string; toolCount: number }>
  >([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(claw.skills ?? []);
  const [isSavingSkills, setIsSavingSkills] = useState(false);

  // Conversation state
  const [conversation, setConversation] = useState<
    Array<{ role: string; content: string; createdAt?: string }>
  >([]);
  const [isLoadingConvo, setIsLoadingConvo] = useState(false);

  // Audit state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilter, setAuditFilter] = useState('');
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Doctor state
  const [doctor, setDoctor] = useState<ClawDoctorResponse | null>(null);
  const [isLoadingDoctor, setIsLoadingDoctor] = useState(false);
  const [isApplyingDoctorFixes, setIsApplyingDoctorFixes] = useState(false);

  // Files state
  const [workspaceFiles, setWorkspaceFiles] = useState<
    Array<{ name: string; path: string; isDirectory: boolean; size: number; modifiedAt: string }>
  >([]);
  const [currentFilePath, setCurrentFilePath] = useState('');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Models state
  const [models, setModels] = useState<
    Array<{ id: string; name: string; provider: string; recommended?: boolean }>
  >([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);

  const toast = useToast();
  const { subscribe } = useGateway();

  const approveEscalation = async (id: string) => {
    try {
      await clawsApi.approveEscalation(id);
      toast.success('Escalation approved');
      onUpdate();
    } catch {
      toast.error('Failed to approve escalation');
    }
  };

  const denyEscalation = async (id: string) => {
    try {
      await clawsApi.denyEscalation(id);
      toast.success('Escalation denied — claw resumed without the request');
      onUpdate();
    } catch {
      toast.error('Failed to deny escalation');
    }
  };

  // Reset state when claw changes
  useEffect(() => {
    setHistory([]);
    setHistoryTotal(0);
    setOutputFeed([]);
    setTab('overview');
    setSelectedSkills(claw.skills ?? []);
    setWorkspaceFiles([]);
    setCurrentFilePath('');
    setFileContent(null);
    setViewingFile(null);
    setConversation([]);
    setAuditEntries([]);
    setAuditTotal(0);
    setAuditFilter('');
    setDoctor(null);
  }, [claw.id]);

  // WS output feed
  useEffect(() => {
    const unsub = subscribe<ClawOutputEvent>('claw.output', (p) => {
      if (p.clawId === claw.id) setOutputFeed((prev) => [p, ...prev].slice(0, 50));
    });
    return () => unsub();
  }, [subscribe, claw.id]);

  // Load history on tab switch
  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, claw.id]);

  // Load audit log on audit tab
  const loadAudit = useCallback(
    async (cat?: string) => {
      setIsLoadingAudit(true);
      try {
        const result = await clawsApi.getAuditLog(claw.id, 50, 0, cat || undefined);
        setAuditEntries(result.entries);
        setAuditTotal(result.total);
      } catch {
        /* ignore */
      } finally {
        setIsLoadingAudit(false);
      }
    },
    [claw.id]
  );

  useEffect(() => {
    if (tab === 'audit') loadAudit(auditFilter || undefined);
  }, [tab, claw.id, auditFilter]);

  const loadDoctor = useCallback(async () => {
    setIsLoadingDoctor(true);
    try {
      setDoctor(await clawsApi.doctor(claw.id));
    } catch {
      toast.error('Failed to load doctor report');
    } finally {
      setIsLoadingDoctor(false);
    }
  }, [claw.id, toast]);

  useEffect(() => {
    if (tab === 'doctor') loadDoctor();
  }, [tab, claw.id, loadDoctor]);

  // Load conversation on conversation tab
  useEffect(() => {
    if (tab === 'conversation') {
      setIsLoadingConvo(true);
      authedFetch(`/api/v1/chat/claw-${claw.id}/messages?limit=50`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((body) => setConversation(body.data ?? []))
        .catch(() => setConversation([]))
        .finally(() => setIsLoadingConvo(false));
    }
  }, [tab, claw.id]);

  // Load files on files tab
  const loadFiles = useCallback(
    async (subPath = '') => {
      if (!claw.workspaceId) return;
      setIsLoadingFiles(true);
      try {
        const { fileWorkspacesApi } = await import('../../api/endpoints/misc');
        const data = await fileWorkspacesApi.files(claw.workspaceId, subPath || undefined);
        setWorkspaceFiles(data.files ?? []);
        setCurrentFilePath(subPath);
        setFileContent(null);
        setViewingFile(null);
      } catch {
        toast.error('Failed to load files');
      } finally {
        setIsLoadingFiles(false);
      }
    },
    [claw.workspaceId, toast]
  );

  const loadFileContent = async (filePath: string) => {
    if (!claw.workspaceId) return;
    try {
      const res = await authedFetch(
        `/api/v1/file-workspaces/${claw.workspaceId}/file/${filePath}?raw=true`
      );
      if (!res.ok) {
        setFileContent('(failed to read file)');
        return;
      }
      const text = await res.text();
      setFileContent(text);
      setViewingFile(filePath);
    } catch {
      setFileContent('(failed to read file)');
    }
  };

  useEffect(() => {
    if (tab === 'files' && workspaceFiles.length === 0 && claw.workspaceId) loadFiles();
  }, [tab, claw.workspaceId]);

  // Load models on settings tab
  useEffect(() => {
    if ((tab === 'settings' || tab === 'overview') && models.length === 0) {
      import('../../api/endpoints/models')
        .then(({ modelsApi }) =>
          modelsApi.list().then((data) => {
            setModels(data.models);
            setConfiguredProviders(data.configuredProviders);
          })
        )
        .catch(() => {});
    }
  }, [tab]);

  // Load skills on tab switch
  useEffect(() => {
    if (tab === 'skills' && availableSkills.length === 0) {
      import('../../api/endpoints/extensions')
        .then(({ extensionsApi }) =>
          extensionsApi
            .list({ status: 'enabled' })
            .then((exts) =>
              setAvailableSkills(
                exts.map((e) => ({ id: e.id, name: e.name, toolCount: e.toolCount }))
              )
            )
        )
        .catch(() => {});
    }
  }, [tab]);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const { entries, total } = await clawsApi.getHistory(claw.id, 20);
      setHistory(entries);
      setHistoryTotal(total);
    } catch {
      toast.error('Failed to load history');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const sendMsg = async () => {
    if (!message.trim()) return;
    try {
      await clawsApi.sendMessage(claw.id, message.trim());
      toast.success('Message sent');
      setMessage('');
    } catch {
      toast.error('Failed to send');
    }
  };

  const saveSkills = async () => {
    setIsSavingSkills(true);
    try {
      await clawsApi.update(claw.id, { skills: selectedSkills });
      toast.success('Skills updated');
      onUpdate();
    } catch {
      toast.error('Failed to update skills');
    } finally {
      setIsSavingSkills(false);
    }
  };

  const applyDoctorFixes = async () => {
    setIsApplyingDoctorFixes(true);
    try {
      const result = await clawsApi.applyRecommendations(claw.id);
      toast.success(
        result.applied.length > 0
          ? `Applied ${result.applied.length} safe fix${result.applied.length === 1 ? '' : 'es'}`
          : 'No safe fixes needed'
      );
      setDoctor({
        health: result.health,
        patch: {},
        applied: [],
        skipped: result.skipped,
      });
      onUpdate();
    } catch {
      toast.error('Failed to apply safe fixes');
    } finally {
      setIsApplyingDoctorFixes(false);
    }
  };

  const badge = getStateBadge(claw.session?.state ?? null);

  return (
    <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-sm animate-fade-in-up">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border dark:border-dark-border flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary truncate">
              {claw.name}
            </h3>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge.classes}`}
            >
              {badge.text}
            </span>
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 truncate">
            {claw.id} · {claw.mode} · sandbox: {claw.sandbox}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary ml-2"
          title="Close"
        >
          <X className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border dark:border-dark-border px-4 overflow-x-auto">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-5 space-y-4 max-h-[600px] overflow-y-auto">
        {tab === 'overview' && (
          <OverviewTab
            claw={claw}
            message={message}
            setMessage={setMessage}
            sendMsg={sendMsg}
            onApproveEscalation={approveEscalation}
            onDenyEscalation={denyEscalation}
            onSwitchToFiles={() => setTab('files')}
            inputClass={ic}
          />
        )}

        {tab === 'settings' && (
          <SettingsTab
            claw={claw}
            models={models}
            configuredProviders={configuredProviders}
            onSaved={onUpdate}
          />
        )}

        {tab === 'skills' && (
          <SkillsTab
            availableSkills={availableSkills}
            selectedSkills={selectedSkills}
            setSelectedSkills={setSelectedSkills}
            saveSkills={saveSkills}
            isSavingSkills={isSavingSkills}
          />
        )}

        {tab === 'history' && (
          <HistoryTab
            history={history}
            historyTotal={historyTotal}
            isLoadingHistory={isLoadingHistory}
            loadHistory={loadHistory}
          />
        )}

        {tab === 'audit' && (
          <AuditTab
            auditEntries={auditEntries}
            auditTotal={auditTotal}
            auditFilter={auditFilter}
            setAuditFilter={setAuditFilter}
            isLoadingAudit={isLoadingAudit}
            loadAudit={loadAudit}
          />
        )}

        {tab === 'doctor' && (
          <DoctorTab
            claw={claw}
            doctor={doctor}
            isLoadingDoctor={isLoadingDoctor}
            isApplyingDoctorFixes={isApplyingDoctorFixes}
            loadDoctor={loadDoctor}
            applyDoctorFixes={applyDoctorFixes}
          />
        )}

        {tab === 'files' && (
          <FilesTab
            claw={claw}
            currentFilePath={currentFilePath}
            workspaceFiles={workspaceFiles}
            isLoadingFiles={isLoadingFiles}
            loadFiles={loadFiles}
            loadFileContent={loadFileContent}
            viewingFile={viewingFile}
            setViewingFile={setViewingFile}
            fileContent={fileContent}
            setFileContent={setFileContent}
            onFileSaved={() => {
              toast.success('File saved');
              loadFiles(currentFilePath);
            }}
          />
        )}

        {tab === 'output' && <OutputTab outputFeed={outputFeed} />}

        {tab === 'conversation' && (
          <ConversationTab conversation={conversation} isLoadingConvo={isLoadingConvo} />
        )}
      </div>
    </div>
  );
}
