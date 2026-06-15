/**
 * AgenticPage — King System for the Agentic Capability Layer.
 *
 * Sections: stats bar, inline command bar, executions table,
 * detail modal, capabilities browser.
 */
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  Play, Square, AlertCircle, Clock, DollarSign, RefreshCw,
  Brain, ListChecks, Target, Zap, X, ChevronDown, ChevronRight,
  Terminal, Send, Code, Wrench, Cpu, CheckCircle2,
} from '../components/icons';
import { agenticApi, type AgenticExecution, type AgenticStats, type ExecuteTaskInput } from '../api/endpoints/agentic';
import { providersApi } from '../api/endpoints/providers';

const POLL_MS = 5_000;
const EXECUTOR_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  claw: Brain, soul_heartbeat: Clock, crew: ListChecks,
  coding_agent: Terminal, workflow: GitBranchIcon, trigger: Zap,
  channel: Send, direct_llm: Cpu, sandbox_code: Code, tool_catalog: Wrench,
};

function GitBranchIcon(props: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function StatusIcon({ status, className }: { status: string; className?: string }) {
  switch (status) {
    case 'completed': return <CheckCircle2 className={`text-green-500 ${className ?? ''}`} />;
    case 'running': return <RefreshCw className={`text-blue-500 animate-spin ${className ?? ''}`} />;
    case 'failed': return <X className={`text-red-500 ${className ?? ''}`} />;
    case 'cancelled': return <Square className={`text-gray-400 ${className ?? ''}`} />;
    case 'partially_completed': return <AlertCircle className={`text-amber-500 ${className ?? ''}`} />;
    case 'escalated': return <AlertCircle className={`text-purple-500 ${className ?? ''}`} />;
    default: return <Clock className={`text-gray-400 ${className ?? ''}`} />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-green-900/30 text-green-400 border-green-700',
    running: 'bg-blue-900/30 text-blue-400 border-blue-700',
    failed: 'bg-red-900/30 text-red-400 border-red-700',
    cancelled: 'bg-gray-800 text-gray-400 border-gray-700',
    partially_completed: 'bg-amber-900/30 text-amber-400 border-amber-700',
    escalated: 'bg-purple-900/30 text-purple-400 border-purple-700',
    pending: 'bg-gray-800 text-gray-400 border-gray-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Stats ──

function StatsBar({ stats }: { stats: AgenticStats | null }) {
  if (!stats) return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl animate-pulse" />)}
    </div>
  );
  const cards = [
    { icon: Play, label: 'Total Executions', value: stats.totalExecutions, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { icon: RefreshCw, label: 'Active Now', value: stats.activeExecutions, color: 'text-green-500', bg: 'bg-green-500/10' },
    { icon: DollarSign, label: 'Total Cost', value: `$${stats.totalCostUsd.toFixed(4)}`, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { icon: Target, label: 'Success Rate', value: `${(stats.successRate * 100).toFixed(1)}%`, color: stats.successRate > 0.8 ? 'text-green-500' : stats.successRate > 0.5 ? 'text-amber-500' : 'text-red-500', bg: 'bg-purple-500/10' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-4 border border-border dark:border-dark-border">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${c.bg}`}><Icon className={`w-5 h-5 ${c.color}`} /></div>
              <div><div className={`text-2xl font-bold ${c.color}`}>{c.value}</div><div className="text-xs text-text-muted dark:text-dark-text-muted">{c.label}</div></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Command Bar ──

function CommandBar({ onExecute }: { onExecute: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'critical'>('normal');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [providers, setProviders] = useState<Array<{ id: string; name?: string }>>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [triggerType, setTriggerType] = useState('immediate');
  const [intervalMs, setIntervalMs] = useState('300000');
  const [timeoutMs, setTimeoutMs] = useState('60000');
  const [running, setRunning] = useState(false);

  // Fetch providers on mount
  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoadingProviders(true);
      try {
        const data = await providersApi.list();
        if (!cancelled) {
          const list = (data.providers ?? []).map((p: { id?: string; name?: string }) => ({
            id: p.id ?? '',
            name: p.name ?? '',
          })).filter((p) => p.id);
          setProviders(list);
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoadingProviders(false); }
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  // Fetch models when provider changes
  useEffect(() => {
    if (!provider) { setModels([]); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoadingModels(true);
      try {
        const data = await providersApi.models(provider);
        if (!cancelled) setModels(data.models ?? []);
      } catch { setModels([]); }
      finally { if (!cancelled) setLoadingModels(false); }
    };
    fetch();
    return () => { cancelled = true; };
  }, [provider]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!description.trim() || running) return;
    setRunning(true);
    try {
      const input: ExecuteTaskInput = {
        name: name.trim() || description.trim().slice(0, 60),
        description: description.trim(), priority,
      };
      if (provider) input.provider = provider;
      if (model) input.model = model;
      if (triggerType === 'interval') input.trigger = { type: 'interval', intervalMs: parseInt(intervalMs, 10) || 300000 };
      else if (triggerType === 'continuous') input.trigger = { type: 'continuous' };
      if (timeoutMs) input.constraints = { timeoutMs: parseInt(timeoutMs, 10) || 60000 };
      await agenticApi.execute(input);
      setName(''); setDescription(''); setProvider(''); setModel(''); setExpanded(false);
      onExecute();
    } finally { setRunning(false); }
  };

  return (
    <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border mb-6">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-5 py-4 text-left">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/10 rounded-lg"><Play className="w-5 h-5 text-purple-500" /></div>
          <div><div className="font-semibold text-text-primary dark:text-dark-text-primary">Execute Agentic Task</div>
          <div className="text-xs text-text-muted dark:text-dark-text-muted">Run a task across claws, coding agents, LLM, sandbox, or auto-route</div></div>
        </div>
        {expanded ? <ChevronDown className="w-5 h-5 text-text-muted" /> : <ChevronRight className="w-5 h-5 text-text-muted" />}
      </button>
      {expanded && (
        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-4 border-t border-border dark:border-dark-border pt-4">
          <div><label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Task Name (optional)</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-generated from description if empty" className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50" /></div>
          <div><label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Task Description *</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Research the latest AI trends and compile a report..." rows={3} className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none" /></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50">
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option>
            </select></div>
            <div><label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Provider</label>
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }} className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50">
              <option value="">System default</option>
              {loadingProviders && <option value="" disabled>Loading...</option>}
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
            </select></div>
            <div><label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!provider || loadingModels} className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-40">
              {!provider && <option value="">Select provider first</option>}
              {provider && <option value="">Provider default</option>}
              {loadingModels && <option value="" disabled>Loading...</option>}
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
            <div><label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Trigger</label>
            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50">
              <option value="immediate">Immediate</option><option value="interval">Interval</option><option value="continuous">Continuous</option>
            </select></div>
            {triggerType === 'interval' && <div><label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Interval (ms)</label>
            <input type="number" value={intervalMs} onChange={(e) => setIntervalMs(e.target.value)} min={1000} step={1000} className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50" /></div>}
            <div><label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Timeout (ms)</label>
            <input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} min={1000} step={1000} className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50" /></div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setExpanded(false)} className="px-4 py-2 text-sm text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors">Cancel</button>
            <button type="submit" disabled={!description.trim() || running} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
              {running ? <><RefreshCw className="w-4 h-4 animate-spin" /> Executing...</> : <><Play className="w-4 h-4" /> Execute</>}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Execution Row ──

function ExecutionRow({ exec, onSelect, onCancel }: { exec: AgenticExecution; onSelect: (id: string) => void; onCancel: (id: string) => void }) {
  const dur = exec.totalDurationMs >= 1000 ? `${(exec.totalDurationMs / 1000).toFixed(1)}s` : `${exec.totalDurationMs}ms`;
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors cursor-pointer border-b border-border dark:border-dark-border last:border-0 group" onClick={() => onSelect(exec.id)}>
      <div className="flex-shrink-0"><StatusIcon status={exec.status} className="w-5 h-5" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2"><span className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate">{exec.taskName}</span><StatusBadge status={exec.status} /></div>
        <div className="text-xs text-text-muted dark:text-dark-text-muted truncate mt-0.5">{exec.summary}</div>
      </div>
      <div className="hidden md:flex items-center gap-4 text-xs text-text-muted dark:text-dark-text-muted">
        <div className="flex items-center gap-1"><ListChecks className="w-3.5 h-3.5" /><span>{exec.completedSteps}/{exec.stepCount} steps</span></div>
        <div className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" /><span>${exec.totalCostUsd.toFixed(4)}</span></div>
        <div className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /><span>{dur}</span></div>
      </div>
      <div className="text-xs text-text-muted dark:text-dark-text-muted hidden lg:block">{new Date(exec.startedAt).toLocaleString()}</div>
      {(exec.status === 'running' || exec.status === 'pending') && (
        <button onClick={(e) => { e.stopPropagation(); onCancel(exec.id); }} className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded-lg transition-all" title="Cancel">
          <Square className="w-4 h-4 text-red-400" />
        </button>
      )}
    </div>
  );
}

// ── Detail Modal ──

function ExecutionDetailModal({ executionId, onClose }: { executionId: string; onClose: () => void }) {
  const [exec, setExec] = useState<AgenticExecution | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async () => {
    try { const data = await agenticApi.get(executionId); setExec(data); return data; } catch { return null; }
  }, [executionId]);

  useEffect(() => {
    let mounted = true;
    fetchDetail().then(() => { if (mounted) setLoading(false); });
    const interval = setInterval(async () => {
      const d = await fetchDetail();
      if (mounted && d && d.status !== 'running' && d.status !== 'pending') clearInterval(interval);
    }, POLL_MS);
    return () => { mounted = false; clearInterval(interval); };
  }, [fetchDetail]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-2xl border border-border dark:border-dark-border shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center gap-3">
            {exec ? <StatusIcon status={exec.status} className="w-6 h-6" /> : <RefreshCw className="w-6 h-6 animate-spin text-purple-500" />}
            <div><div className="font-semibold text-text-primary dark:text-dark-text-primary">{exec?.taskName ?? 'Loading...'}</div>{exec && <StatusBadge status={exec.status} />}</div>
          </div>
          <div className="flex items-center gap-2">
            {(exec?.status === 'running' || exec?.status === 'pending') && (
              <button onClick={async () => { await agenticApi.cancel(executionId); setExec((p) => p ? { ...p, status: 'cancelled' } : p); }} className="px-3 py-1.5 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg transition-colors">Cancel</button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"><X className="w-5 h-5 text-text-muted" /></button>
          </div>
        </div>
        <div className="overflow-y-auto p-6 space-y-6 max-h-[calc(85vh-80px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12"><RefreshCw className="w-8 h-8 animate-spin text-purple-500" /></div>
          ) : !exec ? (
            <div className="text-center py-12 text-text-muted">Execution not found</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryCard label="Status" value={exec.status.replace(/_/g, ' ')} />
                <SummaryCard label="Cost" value={`$${exec.totalCostUsd.toFixed(4)}`} />
                <SummaryCard label="Duration" value={exec.totalDurationMs >= 1000 ? `${(exec.totalDurationMs / 1000).toFixed(1)}s` : `${exec.totalDurationMs}ms`} />
                <SummaryCard label="Steps" value={`${exec.completedSteps}/${exec.stepCount}`} />
              </div>
              {exec.error && <div className="p-3 bg-red-900/20 border border-red-700/30 rounded-lg text-sm text-red-400"><div className="font-medium mb-1">Error</div>{exec.error}</div>}
              {exec.summary && <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-sm">{exec.summary}</div>}
              <div><h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-3">Execution Steps</h3>
              <div className="space-y-2">
                {exec.steps?.map((s) => {
                  const SI = EXECUTOR_ICONS[s.executorKind] ?? AlertCircle;
                  const ds = s.durationMs >= 1000 ? `${(s.durationMs / 1000).toFixed(1)}s` : `${s.durationMs}ms`;
                  return (
                    <div key={s.index} className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                      <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-lg ${s.status === 'completed' ? 'bg-green-500/10' : s.status === 'failed' ? 'bg-red-500/10' : s.status === 'running' ? 'bg-blue-500/10' : 'bg-gray-500/10'}`}>
                          <SI className={`w-4 h-4 ${s.status === 'completed' ? 'text-green-500' : s.status === 'failed' ? 'text-red-500' : s.status === 'running' ? 'text-blue-500' : 'text-gray-400'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">#{s.index} {s.executorKind.replace(/_/g, ' ')}</span>
                            <StatusBadge status={s.status} />
                          </div>
                          <div className="text-xs text-text-muted dark:text-dark-text-muted truncate">{s.capabilityId}</div>
                        </div>
                        <div className="text-right text-xs text-text-muted dark:text-dark-text-muted flex-shrink-0">
                          <div>{ds}</div>
                          {s.costUsd !== undefined && <div>${s.costUsd.toFixed(4)}</div>}
                        </div>
                      </div>
                      {s.error && <div className="mt-2 p-2 bg-red-900/20 rounded text-xs text-red-400">{s.error}</div>}
                    </div>
                  );
                })}
                {(!exec.steps || exec.steps.length === 0) && <div className="text-center py-4 text-text-muted text-sm">No step details available</div>}
              </div></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg"><div className="text-xs text-text-muted dark:text-dark-text-muted mb-0.5">{label}</div><div className="text-sm font-semibold text-text-primary dark:text-dark-text-primary capitalize">{value}</div></div>;
}

// ── Capabilities Panel ──

function CapabilitiesPanel() {
  const [caps, setCaps] = useState<Array<{ id: string; name: string; description: string; executorKind: string; tags: string[]; requiresApproval: boolean }>>([]);
  const [kindFilter, setKindFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await agenticApi.capabilities(kindFilter ? { kind: kindFilter } : undefined);
        if (mounted) setCaps(data.capabilities);
      } finally { if (mounted) setLoading(false); }
    })();
  }, [kindFilter]);

  const byKind = new Map<string, typeof caps>();
  for (const cap of caps) {
    const list = byKind.get(cap.executorKind) ?? [];
    list.push(cap);
    byKind.set(cap.executorKind, list);
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg border border-border dark:border-dark-border text-xs">
          <option value="">All Executor Kinds</option>
          {['claw','soul_heartbeat','crew','coding_agent','workflow','trigger','channel','direct_llm','sandbox_code','tool_catalog'].map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
        </select>
        <span className="text-xs text-text-muted dark:text-dark-text-muted">{caps.length} capabilities</span>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8"><RefreshCw className="w-6 h-6 animate-spin text-purple-500" /></div>
      ) : caps.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">No capabilities found</div>
      ) : (
        <div className="space-y-4">
          {Array.from(byKind.entries()).map(([kind, items]) => (
            <div key={kind}>
              <h4 className="text-xs font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider mb-2">{kind.replace(/_/g, ' ')} ({items.length})</h4>
              <div className="space-y-2">
                {items.map((cap) => (
                  <div key={cap.id} className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">{cap.name}</span>
                      {cap.requiresApproval && <span className="px-1.5 py-0.5 text-[10px] bg-amber-900/30 text-amber-400 rounded">requires approval</span>}
                    </div>
                    <div className="text-xs text-text-muted dark:text-dark-text-muted mb-2">{cap.description}</div>
                    <div className="flex flex-wrap gap-1">{cap.tags.slice(0, 6).map((t) => <span key={t} className="px-1.5 py-0.5 text-[10px] bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted rounded">{t}</span>)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──

type TabId = 'executions' | 'capabilities';

export function AgenticPage() {
  const [executions, setExecutions] = useState<AgenticExecution[]>([]);
  const [stats, setStats] = useState<AgenticStats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('executions');
  const [limit] = useState(20);
  const [offset, setOffset] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const [execData, statsData] = await Promise.all([agenticApi.list(limit, offset), agenticApi.stats()]);
      setExecutions(execData.executions);
      setTotal(execData.total);
      setStats(statsData);
    } catch { /* gateway may not be running */ }
    finally { setLoading(false); }
  }, [limit, offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!executions.some((e) => e.status === 'running' || e.status === 'pending')) return;
    const interval = setInterval(fetchData, POLL_MS);
    return () => clearInterval(interval);
  }, [executions, fetchData]);

  const tabs: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'executions', label: 'Executions', icon: ListChecks },
    { id: 'capabilities', label: 'Capabilities', icon: Brain },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {selectedId && <ExecutionDetailModal executionId={selectedId} onClose={() => setSelectedId(null)} />}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/10 rounded-xl"><Brain className="w-6 h-6 text-purple-500" /></div>
          <div><h1 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">Agentic Command Center</h1>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">Unified task execution across all agent types</p></div>
        </div>
        <button onClick={fetchData} className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors" title="Refresh">
          <RefreshCw className={`w-5 h-5 text-text-muted ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <StatsBar stats={stats} />
      <CommandBar onExecute={fetchData} />

      <div className="flex items-center gap-1 mb-4 border-b border-border dark:border-dark-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${isActive ? 'text-purple-500 border-purple-500' : 'text-text-muted dark:text-dark-text-muted border-transparent hover:text-text-primary dark:hover:text-dark-text-primary'}`}>
              <Icon className="w-4 h-4" />{tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'executions' ? (
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border overflow-hidden">
          <div className="hidden md:flex items-center gap-4 px-4 py-2 text-xs font-medium text-text-muted dark:text-dark-text-muted border-b border-border dark:border-dark-border bg-bg-tertiary/50">
            <div className="w-5" /><div className="flex-1">Task</div>
            <div className="flex items-center gap-4"><span className="w-20 text-right">Progress</span><span className="w-20 text-right">Cost</span><span className="w-20 text-right">Duration</span></div>
            <div className="w-36 text-right hidden lg:block">Started</div><div className="w-8" />
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16"><RefreshCw className="w-8 h-8 animate-spin text-purple-500" /></div>
          ) : executions.length === 0 ? (
            <div className="text-center py-16">
              <Brain className="w-12 h-12 mx-auto text-text-muted/30 mb-3" />
              <div className="text-text-muted dark:text-dark-text-muted text-sm">No executions yet</div>
              <div className="text-text-muted/60 text-xs mt-1">Run a task using the command bar above</div>
            </div>
          ) : (
            <>
              {executions.map((exec) => (
                <ExecutionRow key={exec.id} exec={exec} onSelect={setSelectedId} onCancel={async (id) => { await agenticApi.cancel(id); fetchData(); }} />
              ))}
              {total > limit && (
                <div className="flex items-center justify-between px-4 py-3 text-xs text-text-muted border-t border-border dark:border-dark-border">
                  <span>{offset + 1}-{Math.min(offset + limit, total)} of {total}</span>
                  <div className="flex gap-2">
                    <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="px-3 py-1 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded disabled:opacity-30">Previous</button>
                    <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)} className="px-3 py-1 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded disabled:opacity-30">Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border p-5">
          <CapabilitiesPanel />
        </div>
      )}
    </div>
  );
}
