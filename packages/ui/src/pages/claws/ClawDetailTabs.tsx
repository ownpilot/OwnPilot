import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ClawConfig, ClawHistoryEntry } from '../../api/endpoints/claws';
import { clawsApi } from '../../api/endpoints/claws';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/ToastProvider';
import { XCircle, CheckCircle2, FolderOpen, Send, Save } from '../../components/icons';
import { formatDuration, formatCost, timeAgo, labelClass as lbl, inputClass as ic } from './utils';
import { FileBrowser, FileEditorModal } from './FileBrowser';

// ============================================================================
// Overview
// ============================================================================

export function OverviewTab({
  claw,
  message,
  setMessage,
  sendMsg,
  onApproveEscalation,
  onDenyEscalation,
  onSwitchToFiles,
  inputClass: ic,
}: {
  claw: ClawConfig;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  sendMsg: () => void;
  onApproveEscalation: (id: string) => void;
  onDenyEscalation: (id: string) => void;
  onSwitchToFiles: () => void;
  inputClass: string;
}) {
  return (
    <>
      {claw.session && ['running', 'starting'].includes(claw.session.state) && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Claw is running
              {claw.session.lastCycleAt && ` · last cycle ${timeAgo(claw.session.lastCycleAt)}`}
            </p>
            <p className="text-xs text-green-600/70 dark:text-green-500/70">
              Mode: {claw.mode}
              {claw.mode === 'interval' &&
                claw.intervalMs &&
                ` · every ${Math.round(claw.intervalMs / 1000)}s`}
              {claw.mode === 'event' && ' · waiting for events'}
            </p>
          </div>
        </div>
      )}
      {claw.session?.state === 'waiting' && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <div className="relative flex h-3 w-3">
            <span className="animate-pulse relative inline-flex rounded-full h-3 w-3 bg-cyan-500" />
          </div>
          <p className="text-sm text-cyan-700 dark:text-cyan-400">
            Waiting for event
            {claw.eventFilters?.length ? `: ${claw.eventFilters.join(', ')}` : ''}
          </p>
        </div>
      )}
      {claw.session?.lastCycleError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400 truncate">
            Last error: {claw.session.lastCycleError}
          </p>
        </div>
      )}

      <div>
        <p className={lbl}>Mission</p>
        <p className="text-sm text-text-secondary dark:text-dark-text-secondary">{claw.mission}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Cycles', value: claw.session?.cyclesCompleted ?? 0 },
          { label: 'Tool Calls', value: claw.session?.totalToolCalls ?? 0 },
          { label: 'Cost', value: formatCost(claw.session?.totalCostUsd ?? 0) },
          {
            label: 'Last Cycle',
            value: claw.session?.lastCycleDurationMs
              ? formatDuration(claw.session.lastCycleDurationMs)
              : '-',
          },
        ].map((s) => (
          <div key={s.label} className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">{s.label}</p>
            <p className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {claw.health && (
          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
            health {claw.health.score} · {claw.health.status}
          </span>
        )}
        {claw.preset && (
          <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-full">
            {claw.preset}
          </span>
        )}
        <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">
          {claw.mode}
        </span>
        <span className="px-2 py-0.5 bg-gray-500/10 text-gray-600 dark:text-gray-400 rounded-full">
          sandbox: {claw.sandbox}
        </span>
        {claw.provider && (
          <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full">
            {claw.provider}
            {claw.model ? ` / ${claw.model}` : ''}
          </span>
        )}
        {!claw.provider && (
          <span className="px-2 py-0.5 bg-gray-500/10 text-gray-500 rounded-full">
            system model
          </span>
        )}
        {claw.codingAgentProvider && (
          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
            {claw.codingAgentProvider}
          </span>
        )}
        {claw.soulId && (
          <span className="px-2 py-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-full">
            soul
          </span>
        )}
        {claw.autoStart && (
          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full">
            auto-start
          </span>
        )}
        {(claw.skills?.length ?? 0) > 0 && (
          <span className="px-2 py-0.5 bg-pink-500/10 text-pink-600 dark:text-pink-400 rounded-full">
            {claw.skills!.length} skills
          </span>
        )}
        {claw.depth > 0 && (
          <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-full">
            depth {claw.depth}
          </span>
        )}
        {claw.session?.artifacts && claw.session.artifacts.length > 0 && (
          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
            {claw.session.artifacts.length} artifacts
          </span>
        )}
      </div>

      {claw.missionContract &&
        (claw.missionContract.successCriteria.length > 0 ||
          claw.missionContract.deliverables.length > 0) && (
          <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
            <p className={lbl}>Mission Contract</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 text-xs text-text-secondary dark:text-dark-text-secondary">
              <div>
                <p className="font-medium text-text-primary dark:text-dark-text-primary">Success</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {claw.missionContract.successCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-text-primary dark:text-dark-text-primary">
                  Deliverables
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {claw.missionContract.deliverables.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

      {claw.workspaceId && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">Workspace</p>
            <p className="text-sm text-text-primary dark:text-dark-text-primary truncate font-mono">
              {claw.workspaceId}
            </p>
          </div>
          <button
            onClick={onSwitchToFiles}
            className="text-xs text-primary hover:underline shrink-0"
          >
            Browse Files
          </button>
          <a
            href={`/api/v1/file-workspaces/${claw.workspaceId}/download`}
            className="text-xs text-primary hover:underline shrink-0"
          >
            Download ZIP
          </a>
        </div>
      )}

      {claw.session?.artifacts && claw.session.artifacts.length > 0 && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className={lbl}>Artifacts ({claw.session.artifacts.length})</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {claw.session.artifacts.map((artId) => (
              <a
                key={artId}
                href={`/artifacts?id=${artId}`}
                className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded hover:bg-emerald-500/20 transition-colors font-mono"
              >
                {artId.slice(0, 12)}...
              </a>
            ))}
          </div>
        </div>
      )}

      {claw.session?.state === 'escalation_pending' && claw.session.pendingEscalation && (
        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <p className="text-sm font-medium text-purple-600 dark:text-purple-400">
            Escalation Pending
          </p>
          <p className="text-xs text-purple-500 mt-1">
            {claw.session.pendingEscalation.type}: {claw.session.pendingEscalation.reason}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => onApproveEscalation(claw.id)}
              className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors font-medium"
            >
              Approve
            </button>
            <button
              onClick={() => onDenyEscalation(claw.id)}
              className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {claw.session && ['running', 'waiting', 'paused'].includes(claw.session.state) && (
        <div className="flex items-center gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
            placeholder="Send a message..."
            className={`flex-1 ${ic} placeholder:text-text-muted`}
          />
          <button
            onClick={sendMsg}
            className="p-2 rounded-lg bg-primary text-white hover:bg-primary/90"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Skills
// ============================================================================

export function SkillsTab({
  availableSkills,
  selectedSkills,
  setSelectedSkills,
  saveSkills,
  isSavingSkills,
}: {
  availableSkills: Array<{ id: string; name: string; toolCount: number }>;
  selectedSkills: string[];
  setSelectedSkills: Dispatch<SetStateAction<string[]>>;
  saveSkills: () => void;
  isSavingSkills: boolean;
}) {
  return (
    <>
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Select which skills (extensions) this claw can use. Each skill provides specialized tools.
      </p>
      {availableSkills.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No skills installed. Install skills from the Skills Hub.
        </p>
      ) : (
        <div className="space-y-1">
          {availableSkills.map((sk) => (
            <label
              key={sk.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                selectedSkills.includes(sk.id)
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary border border-transparent'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedSkills.includes(sk.id)}
                onChange={() =>
                  setSelectedSkills((p) =>
                    p.includes(sk.id) ? p.filter((s) => s !== sk.id) : [...p, sk.id]
                  )
                }
                className="w-4 h-4 rounded accent-primary"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {sk.name}
                </span>
                <span className="text-xs text-text-muted dark:text-dark-text-muted ml-2">
                  {sk.toolCount} tools
                </span>
              </div>
            </label>
          ))}
        </div>
      )}
      <button
        onClick={saveSkills}
        disabled={isSavingSkills}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {isSavingSkills ? 'Saving...' : `Save Skills (${selectedSkills.length})`}
      </button>
    </>
  );
}

// ============================================================================
// History
// ============================================================================

export function HistoryTab({
  history,
  historyTotal,
  isLoadingHistory,
  loadHistory,
}: {
  history: ClawHistoryEntry[];
  historyTotal: number;
  isLoadingHistory: boolean;
  loadHistory: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          {historyTotal} total entries
        </p>
        <button onClick={loadHistory} className="text-xs text-primary hover:underline">
          Refresh
        </button>
      </div>
      {isLoadingHistory ? (
        <LoadingSpinner message="Loading..." />
      ) : history.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No history yet.
        </p>
      ) : (
        <div className="space-y-2">
          {history.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary"
            >
              {entry.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span>Cycle {entry.cycleNumber}</span>
                  <span>{formatDuration(entry.durationMs)}</span>
                  {entry.costUsd !== undefined && <span>{formatCost(entry.costUsd)}</span>}
                  <span>{entry.toolCalls.length} tools</span>
                  {entry.entryType === 'escalation' && (
                    <span className="text-purple-500">escalation</span>
                  )}
                </div>
                <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-1 line-clamp-3">
                  {entry.error ?? entry.outputMessage.slice(0, 300)}
                </p>
              </div>
              <span className="text-xs text-text-muted dark:text-dark-text-muted shrink-0">
                {timeAgo(entry.executedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ============================================================================
// Audit
// ============================================================================

export interface AuditEntry {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: string;
  success: boolean;
  durationMs: number;
  category: string;
  cycleNumber: number;
  executedAt: string;
}

const AUDIT_CAT_COLORS: Record<string, string> = {
  claw: 'bg-primary/10 text-primary',
  cli: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  browser: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  'coding-agent': 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  web: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  'code-exec': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  git: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  filesystem: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  knowledge: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  tool: 'bg-gray-500/10 text-gray-500',
};

export function AuditTab({
  auditEntries,
  auditTotal,
  auditFilter,
  setAuditFilter,
  isLoadingAudit,
  loadAudit,
}: {
  auditEntries: AuditEntry[];
  auditTotal: number;
  auditFilter: string;
  setAuditFilter: Dispatch<SetStateAction<string>>;
  isLoadingAudit: boolean;
  loadAudit: (cat?: string) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          {auditTotal} tool calls logged
        </p>
        <div className="flex-1" />
        <select
          value={auditFilter}
          onChange={(e) => setAuditFilter(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
        >
          <option value="">All categories</option>
          <option value="claw">Claw tools</option>
          <option value="cli">CLI tools</option>
          <option value="browser">Browser</option>
          <option value="coding-agent">Coding agents</option>
          <option value="web">Web/API</option>
          <option value="code-exec">Code execution</option>
          <option value="git">Git</option>
          <option value="filesystem">Filesystem</option>
          <option value="knowledge">Knowledge (memory/goals)</option>
          <option value="tool">Other tools</option>
        </select>
        <button
          onClick={() => loadAudit(auditFilter || undefined)}
          className="text-xs text-primary hover:underline"
        >
          Refresh
        </button>
      </div>

      {isLoadingAudit ? (
        <LoadingSpinner message="Loading audit log..." />
      ) : auditEntries.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No audit entries yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {auditEntries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 px-3 py-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary text-xs"
            >
              {entry.success ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary">
                    {entry.toolName}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${AUDIT_CAT_COLORS[entry.category] ?? AUDIT_CAT_COLORS.tool}`}
                  >
                    {entry.category}
                  </span>
                  <span className="text-text-muted dark:text-dark-text-muted">
                    cycle {entry.cycleNumber} · {formatDuration(entry.durationMs)}
                  </span>
                </div>
                {Object.keys(entry.toolArgs).length > 0 && (
                  <p className="text-text-muted dark:text-dark-text-muted mt-0.5 truncate font-mono">
                    {JSON.stringify(entry.toolArgs).slice(0, 120)}
                  </p>
                )}
                {entry.toolResult && !entry.success && (
                  <p className="text-red-500 mt-0.5 truncate">{entry.toolResult.slice(0, 100)}</p>
                )}
              </div>
              <span className="text-text-muted dark:text-dark-text-muted shrink-0">
                {timeAgo(entry.executedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ============================================================================
// Files
// ============================================================================

export function FilesTab({
  claw,
  currentFilePath,
  workspaceFiles,
  isLoadingFiles,
  loadFiles,
  loadFileContent,
  viewingFile,
  setViewingFile,
  fileContent,
  setFileContent,
  onFileSaved,
}: {
  claw: ClawConfig;
  currentFilePath: string;
  workspaceFiles: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: string;
  }>;
  isLoadingFiles: boolean;
  loadFiles: (subPath?: string) => void;
  loadFileContent: (filePath: string) => void;
  viewingFile: string | null;
  setViewingFile: Dispatch<SetStateAction<string | null>>;
  fileContent: string | null;
  setFileContent: Dispatch<SetStateAction<string | null>>;
  onFileSaved: () => void;
}) {
  return (
    <>
      {!claw.workspaceId ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No workspace assigned. Start the claw to create one.
        </p>
      ) : (
        <FileBrowser
          workspaceId={claw.workspaceId}
          currentPath={currentFilePath}
          files={workspaceFiles}
          isLoading={isLoadingFiles}
          onNavigate={loadFiles}
          onOpenFile={loadFileContent}
          onRefresh={() => loadFiles(currentFilePath)}
          onFileCreated={() => loadFiles(currentFilePath)}
        />
      )}
      {viewingFile && claw.workspaceId && (
        <FileEditorModal
          workspaceId={claw.workspaceId}
          filePath={viewingFile}
          content={fileContent}
          onClose={() => {
            setViewingFile(null);
            setFileContent(null);
          }}
          onSaved={onFileSaved}
        />
      )}
    </>
  );
}

// ============================================================================
// Output
// ============================================================================

export interface ClawOutputEvent {
  clawId: string;
  message?: string;
  type?: string;
  title?: string;
  summary?: string;
  urgency?: string;
  timestamp: string;
}

export function OutputTab({ outputFeed }: { outputFeed: ClawOutputEvent[] }) {
  return (
    <>
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Live output from claw_send_output and claw_complete_report tool calls.
      </p>
      {outputFeed.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-8 text-center">
          No output yet. The claw will send results here as it works.
        </p>
      ) : (
        <div className="space-y-2">
          {outputFeed.map((evt, i) => (
            <div
              key={`${evt.timestamp}-${i}`}
              className="p-3 rounded-lg bg-primary/5 border border-primary/10"
            >
              {evt.type === 'report' ? (
                <div>
                  <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {evt.title}
                  </p>
                  <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-1">
                    {evt.summary}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-text-primary dark:text-dark-text-primary whitespace-pre-wrap">
                  {evt.message}
                </p>
              )}
              <span className="text-xs text-text-muted dark:text-dark-text-muted mt-1 block">
                {timeAgo(evt.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ============================================================================
// Conversation
// ============================================================================

export function ConversationTab({
  conversation,
  isLoadingConvo,
}: {
  conversation: Array<{ role: string; content: string; createdAt?: string }>;
  isLoadingConvo: boolean;
}) {
  return (
    <>
      <p className="text-xs text-text-muted dark:text-dark-text-muted mb-3">
        Messages stored by claw_send_output and claw_complete_report in the claw's conversation.
      </p>
      {isLoadingConvo ? (
        <LoadingSpinner message="Loading..." />
      ) : conversation.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No conversation messages yet. The claw will write here when it uses claw_send_output or
          claw_complete_report.
        </p>
      ) : (
        <div className="space-y-3">
          {conversation.map((msg, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg ${
                msg.role === 'assistant'
                  ? 'bg-primary/5 border border-primary/10'
                  : 'bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase">
                  {msg.role}
                </span>
                {msg.createdAt && (
                  <span className="text-xs text-text-muted dark:text-dark-text-muted">
                    {timeAgo(msg.createdAt)}
                  </span>
                )}
              </div>
              <div className="text-sm text-text-primary dark:text-dark-text-primary whitespace-pre-wrap leading-relaxed">
                {msg.content.length > 2000 ? msg.content.slice(0, 2000) + '...' : msg.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ============================================================================
// Settings
// ============================================================================

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  recommended?: boolean;
}

const splitLines = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

export function SettingsTab({
  claw,
  models,
  configuredProviders,
  onSaved,
}: {
  claw: ClawConfig;
  models: ModelEntry[];
  configuredProviders: string[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [editMission, setEditMission] = useState(claw.mission);
  const [editMode, setEditMode] = useState(claw.mode);
  const [editSandbox, setEditSandbox] = useState(claw.sandbox);
  const [editCodingAgent, setEditCodingAgent] = useState(claw.codingAgentProvider ?? '');
  const [editIntervalMs, setEditIntervalMs] = useState(claw.intervalMs ?? 300_000);
  const [editEventFilters, setEditEventFilters] = useState((claw.eventFilters ?? []).join(', '));
  const [editAutoStart, setEditAutoStart] = useState(claw.autoStart);
  const [editStopCondition, setEditStopCondition] = useState(claw.stopCondition ?? '');
  const [editProvider, setEditProvider] = useState(claw.provider ?? '');
  const [editModel, setEditModel] = useState(claw.model ?? '');
  const [editBudget, setEditBudget] = useState(claw.limits.totalBudgetUsd ?? 0);
  const [editSuccessCriteria, setEditSuccessCriteria] = useState(
    (claw.missionContract?.successCriteria ?? []).join('\n')
  );
  const [editDeliverables, setEditDeliverables] = useState(
    (claw.missionContract?.deliverables ?? []).join('\n')
  );
  const [editConstraints, setEditConstraints] = useState(
    (claw.missionContract?.constraints ?? []).join('\n')
  );
  const [editEvidenceRequired, setEditEvidenceRequired] = useState(
    claw.missionContract?.evidenceRequired ?? true
  );
  const [editAllowSelfModify, setEditAllowSelfModify] = useState(
    claw.autonomyPolicy?.allowSelfModify ?? false
  );
  const [editAllowSubclaws, setEditAllowSubclaws] = useState(
    claw.autonomyPolicy?.allowSubclaws ?? true
  );
  const [editDestructivePolicy, setEditDestructivePolicy] = useState<'ask' | 'block' | 'allow'>(
    claw.autonomyPolicy?.destructiveActionPolicy ?? 'ask'
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditMission(claw.mission);
    setEditMode(claw.mode);
    setEditSandbox(claw.sandbox);
    setEditCodingAgent(claw.codingAgentProvider ?? '');
    setEditIntervalMs(claw.intervalMs ?? 300_000);
    setEditEventFilters((claw.eventFilters ?? []).join(', '));
    setEditAutoStart(claw.autoStart);
    setEditStopCondition(claw.stopCondition ?? '');
    setEditProvider(claw.provider ?? '');
    setEditModel(claw.model ?? '');
    setEditBudget(claw.limits.totalBudgetUsd ?? 0);
    setEditSuccessCriteria((claw.missionContract?.successCriteria ?? []).join('\n'));
    setEditDeliverables((claw.missionContract?.deliverables ?? []).join('\n'));
    setEditConstraints((claw.missionContract?.constraints ?? []).join('\n'));
    setEditEvidenceRequired(claw.missionContract?.evidenceRequired ?? true);
    setEditAllowSelfModify(claw.autonomyPolicy?.allowSelfModify ?? false);
    setEditAllowSubclaws(claw.autonomyPolicy?.allowSubclaws ?? true);
    setEditDestructivePolicy(claw.autonomyPolicy?.destructiveActionPolicy ?? 'ask');
  }, [claw.id]);

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      await clawsApi.update(claw.id, {
        mission: editMission,
        mode: editMode,
        sandbox: editSandbox,
        coding_agent_provider: editCodingAgent || null,
        provider: editProvider || null,
        model: editModel || null,
        interval_ms: editMode === 'interval' ? editIntervalMs : undefined,
        event_filters:
          editMode === 'event' && editEventFilters.trim()
            ? editEventFilters
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        auto_start: editAutoStart,
        stop_condition: editStopCondition.trim() || null,
        mission_contract: {
          successCriteria: splitLines(editSuccessCriteria),
          deliverables: splitLines(editDeliverables),
          constraints: splitLines(editConstraints),
          escalationRules: claw.missionContract?.escalationRules ?? [],
          evidenceRequired: editEvidenceRequired,
          minConfidence: claw.missionContract?.minConfidence ?? 0.8,
        },
        autonomy_policy: {
          allowSelfModify: editAllowSelfModify,
          allowSubclaws: editAllowSubclaws,
          requireEvidence: editEvidenceRequired,
          destructiveActionPolicy: editDestructivePolicy,
          filesystemScopes: claw.autonomyPolicy?.filesystemScopes ?? [],
          maxCostUsdBeforePause: editBudget > 0 ? editBudget : undefined,
        },
        limits: { ...claw.limits, totalBudgetUsd: editBudget > 0 ? editBudget : undefined },
      });
      toast.success('Settings saved');
      onSaved();
    } catch {
      toast.error('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div>
        <label className={lbl}>Mission</label>
        <textarea
          value={editMission}
          onChange={(e) => setEditMission(e.target.value)}
          rows={3}
          className={`${ic} resize-none`}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={lbl}>Mode</label>
          <select
            value={editMode}
            onChange={(e) => setEditMode(e.target.value as typeof editMode)}
            className={ic}
          >
            <option value="single-shot">Single-shot</option>
            <option value="continuous">Continuous</option>
            <option value="interval">Interval</option>
            <option value="event">Event-driven</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Sandbox</label>
          <select
            value={editSandbox}
            onChange={(e) => setEditSandbox(e.target.value as typeof editSandbox)}
            className={ic}
          >
            <option value="auto">Auto</option>
            <option value="docker">Docker</option>
            <option value="local">Local</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Coding Agent</label>
          <select
            value={editCodingAgent}
            onChange={(e) => setEditCodingAgent(e.target.value)}
            className={ic}
          >
            <option value="">None</option>
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex CLI</option>
            <option value="gemini-cli">Gemini CLI</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Budget (USD)</label>
          <input
            type="number"
            value={editBudget}
            onChange={(e) => setEditBudget(Number(e.target.value))}
            min={0}
            step={0.1}
            className={ic}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>AI Provider</label>
          <select
            value={editProvider}
            onChange={(e) => {
              setEditProvider(e.target.value);
              setEditModel('');
            }}
            className={ic}
          >
            <option value="">System Default</option>
            {configuredProviders.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>AI Model</label>
          <select value={editModel} onChange={(e) => setEditModel(e.target.value)} className={ic}>
            <option value="">System Default</option>
            {models
              .filter((m) => !editProvider || m.provider === editProvider)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.recommended ? ' *' : ''}
                  {editProvider ? '' : ` (${m.provider})`}
                </option>
              ))}
          </select>
        </div>
      </div>
      {!editProvider && (
        <p className="text-xs text-text-muted dark:text-dark-text-muted -mt-2">
          Using system model routing (pulse process). Set a specific provider/model to override.
        </p>
      )}

      {editMode === 'interval' && (
        <div>
          <label className={lbl}>Interval (seconds)</label>
          <input
            type="number"
            value={Math.round(editIntervalMs / 1000)}
            onChange={(e) => setEditIntervalMs(Number(e.target.value) * 1000)}
            min={10}
            className={ic}
          />
        </div>
      )}
      {editMode === 'event' && (
        <div>
          <label className={lbl}>Event Filters (comma-separated)</label>
          <input
            value={editEventFilters}
            onChange={(e) => setEditEventFilters(e.target.value)}
            placeholder="user.message, webhook.received"
            className={ic}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Stop Condition</label>
          <input
            value={editStopCondition}
            onChange={(e) => setEditStopCondition(e.target.value)}
            placeholder="e.g., max_cycles:100"
            className={ic}
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editAutoStart}
              onChange={(e) => setEditAutoStart(e.target.checked)}
              className="w-4 h-4 rounded accent-primary"
            />
            <span className="text-sm text-text-primary dark:text-dark-text-primary">
              Auto-start on boot
            </span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={lbl}>Success Criteria</label>
            <textarea
              value={editSuccessCriteria}
              onChange={(e) => setEditSuccessCriteria(e.target.value)}
              rows={4}
              placeholder="One criterion per line"
              className={`${ic} resize-none`}
            />
          </div>
          <div>
            <label className={lbl}>Deliverables</label>
            <textarea
              value={editDeliverables}
              onChange={(e) => setEditDeliverables(e.target.value)}
              rows={4}
              placeholder="One deliverable per line"
              className={`${ic} resize-none`}
            />
          </div>
          <div>
            <label className={lbl}>Constraints</label>
            <textarea
              value={editConstraints}
              onChange={(e) => setEditConstraints(e.target.value)}
              rows={4}
              placeholder="One constraint per line"
              className={`${ic} resize-none`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary">
            <input
              type="checkbox"
              checked={editEvidenceRequired}
              onChange={(e) => setEditEvidenceRequired(e.target.checked)}
              className="w-4 h-4 rounded accent-primary"
            />
            Evidence
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary">
            <input
              type="checkbox"
              checked={editAllowSubclaws}
              onChange={(e) => setEditAllowSubclaws(e.target.checked)}
              className="w-4 h-4 rounded accent-primary"
            />
            Sub-claws
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary">
            <input
              type="checkbox"
              checked={editAllowSelfModify}
              onChange={(e) => setEditAllowSelfModify(e.target.checked)}
              className="w-4 h-4 rounded accent-primary"
            />
            Self-modify
          </label>
          <select
            value={editDestructivePolicy}
            onChange={(e) => setEditDestructivePolicy(e.target.value as 'ask' | 'block' | 'allow')}
            className={ic}
          >
            <option value="ask">Ask before destructive</option>
            <option value="block">Block destructive</option>
            <option value="allow">Allow destructive</option>
          </select>
        </div>
      </div>

      <button
        onClick={saveSettings}
        disabled={isSaving}
        className="flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {isSaving ? 'Saving...' : 'Save Settings'}
      </button>
    </>
  );
}
