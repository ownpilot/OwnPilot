import { useState } from 'react';
import { Copy, CheckCircle2, ExternalLink, Terminal } from '../../../components/icons';
import type { ClawConfig } from '../../../api/endpoints/claws';
import { timeAgo } from '../utils';

export function ConfigTab({ claw }: { claw: ClawConfig }) {
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const config = JSON.stringify(claw, null, 2);
  const configLineCount = config.split('\n').length;

  const copy = () => {
    navigator.clipboard.writeText(config).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const statRows = [
    { label: 'ID', value: claw.id, mono: true },
    { label: 'Name', value: claw.name },
    { label: 'Mode', value: claw.mode, badge: claw.mode },
    { label: 'Sandbox', value: claw.sandbox },
    { label: 'Depth', value: claw.depth },
    { label: 'Priority', value: claw.priority ?? 3 },
    { label: 'Provider', value: claw.provider ?? 'system' },
    { label: 'Model', value: claw.model ?? 'default' },
    { label: 'Coding Agent', value: claw.codingAgentProvider ?? '-' },
    { label: 'Workspace', value: claw.workspaceId ? `${claw.workspaceId.slice(0, 16)}...` : '-' },
    { label: 'Soul', value: claw.soulId ?? '-' },
    { label: 'Parent', value: claw.parentClawId ? `${claw.parentClawId.slice(0, 16)}...` : '-' },
    { label: 'Auto-start', value: claw.autoStart ? 'yes' : 'no' },
    { label: 'Created', value: timeAgo(claw.createdAt) },
    { label: 'Updated', value: timeAgo(claw.updatedAt) },
    { label: 'Skills', value: `${claw.skills?.length ?? 0}` },
    { label: 'Allowed Tools', value: `${claw.allowedTools?.length ?? 0}` },
    { label: 'Max Turns/Cycle', value: claw.limits.maxTurnsPerCycle },
    { label: 'Max Tool Calls/Cycle', value: claw.limits.maxToolCallsPerCycle },
    { label: 'Max Cycles/Hour', value: claw.limits.maxCyclesPerHour },
    { label: 'Cycle Timeout', value: `${Math.round(claw.limits.cycleTimeoutMs / 1000)}s` },
    {
      label: 'Total Budget',
      value: claw.limits.totalBudgetUsd ? `$${claw.limits.totalBudgetUsd}` : 'unlimited',
    },
    { label: 'Interval', value: claw.intervalMs ? `${claw.intervalMs / 1000}s` : '-' },
    { label: 'Stop Condition', value: claw.stopCondition ?? '-' },
    { label: 'Preset', value: claw.preset ?? '-' },
    { label: 'Created By', value: claw.createdBy },
  ];

  const filteredRows = searchQuery
    ? statRows.filter(
        (r) =>
          r.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          String(r.value).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : statRows;

  const visibleRows = searchQuery ? filteredRows : showAll ? statRows : statRows.slice(0, 9);
  const hiddenCount = !searchQuery && !showAll ? statRows.length - 9 : 0;

  return (
    <div className="space-y-4">
      {/* Summary stats grid */}
      <div className="flex items-center gap-2 mb-2">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search config..."
          className="flex-1 px-2 py-1 text-xs rounded border border-gray-700 bg-[#1a1a1a] text-gray-300 font-mono placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
        />
        {!searchQuery && statRows.length > 9 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border text-text-muted hover:text-text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors shrink-0"
          >
            {showAll ? `Show top 9` : `Show all (${statRows.length})`}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {visibleRows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col p-2.5 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary min-w-0"
          >
            <p className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
              {row.label}
            </p>
            <p
              className={`text-sm font-medium text-text-primary dark:text-dark-text-primary truncate mt-0.5 ${row.mono ? 'font-mono' : ''}`}
            >
              {String(row.value)}
            </p>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs text-primary hover:underline"
        >
          + {hiddenCount} more — show all
        </button>
      )}
      {searchQuery && filteredRows.length === 0 && (
        <p className="text-xs text-text-muted italic">No config rows match "{searchQuery}"</p>
      )}

      {/* Limits detail */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">
          Limits Detail
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-xs">
          {[
            { label: 'Max Turns/Cycle', value: claw.limits.maxTurnsPerCycle },
            { label: 'Max Tool Calls/Cycle', value: claw.limits.maxToolCallsPerCycle },
            { label: 'Max Cycles/Hour', value: claw.limits.maxCyclesPerHour },
            { label: 'Cycle Timeout', value: `${Math.round(claw.limits.cycleTimeoutMs / 1000)}s` },
            {
              label: 'Total Budget',
              value: claw.limits.totalBudgetUsd ? `$${claw.limits.totalBudgetUsd}` : 'none',
            },
          ].map((l) => (
            <div
              key={l.label}
              className="flex justify-between p-1.5 bg-bg-primary dark:bg-dark-bg-primary rounded"
            >
              <span className="text-text-muted">{l.label}</span>
              <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary">
                {l.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Allowed tools */}
      {claw.allowedTools.length > 0 && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">
            Allowed Tools ({claw.allowedTools.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {claw.allowedTools.map((tool) => (
              <span
                key={tool}
                className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary font-mono"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Mission */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
            Mission
          </p>
          <span className="text-[10px] text-text-muted">{claw.mission.length} chars</span>
        </div>
        <p className="text-xs text-text-secondary dark:text-dark-text-secondary whitespace-pre-wrap leading-relaxed">
          {claw.mission}
        </p>
      </div>

      {/* Stop condition */}
      {claw.stopCondition && (
        <div className="flex items-center gap-2 p-2 rounded bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-xs text-text-muted shrink-0">Stop:</span>
          <code className="text-xs font-mono text-cyan-400 bg-cyan-500/5 px-1.5 py-0.5 rounded flex-1">
            {claw.stopCondition}
          </code>
        </div>
      )}

      {/* Raw JSON with toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          Full JSON configuration · {configLineCount} lines · {config.length} chars
        </p>
        <div className="flex items-center gap-2">
          <a
            href={`/api/v1/claws/${claw.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            API <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
          >
            {copied ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
        </div>
      </div>
      <pre className="p-4 text-xs font-mono bg-[#0d0d0d] text-gray-300 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap leading-relaxed border border-border dark:border-dark-border">
        {config}
      </pre>
    </div>
  );
}
