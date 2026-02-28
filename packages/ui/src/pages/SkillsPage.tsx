/**
 * Skills Page
 *
 * Manages AgentSkills.io open standard skills (SKILL.md format).
 * Skills are instruction-based knowledge packages that guide the AI agent.
 * Separate from User Extensions (which are executable tool bundles).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BookOpen,
  Power,
  FolderOpen,
  X,
  Globe,
  FileText,
  Code,
  ChevronDown,
  ChevronRight,
  Trash2,
  RefreshCw,
  Upload,
  Sparkles,
  Shield,
  ShieldCheck,
  Brain,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
} from '../components/icons';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/ToastProvider';
import { extensionsApi } from '../api/endpoints/extensions';
import type { ExtensionAuditResult } from '../api/endpoints/extensions';
import type { ExtensionInfo } from '../api/types';

const CATEGORY_COLORS: Record<string, string> = {
  developer: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
  productivity: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  communication: 'bg-green-500/20 text-green-600 dark:text-green-400',
  data: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  utilities: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400',
  integrations: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  media: 'bg-pink-500/20 text-pink-600 dark:text-pink-400',
  other: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
};

const RISK_COLORS: Record<string, string> = {
  low: 'text-success',
  medium: 'text-warning',
  high: 'text-error',
  critical: 'text-error',
};

const RISK_BADGE: Record<string, { label: string; color: string }> = {
  low: { label: 'Low Risk', color: 'bg-success/15 text-success' },
  medium: { label: 'Medium Risk', color: 'bg-warning/15 text-warning' },
  high: { label: 'High Risk', color: 'bg-error/15 text-error' },
  critical: { label: 'Critical', color: 'bg-error/20 text-error font-semibold' },
};

const VERDICT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  safe: { label: 'Safe', color: 'text-success', bg: 'bg-success/10 border-success/30' },
  caution: { label: 'Caution', color: 'text-warning', bg: 'bg-warning/10 border-warning/30' },
  unsafe: { label: 'Unsafe', color: 'text-error', bg: 'bg-error/10 border-error/30' },
};

export function SkillsPage() {
  const toast = useToast();
  const [skills, setSkills] = useState<ExtensionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<ExtensionInfo | null>(null);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const fetchSkills = useCallback(async () => {
    try {
      const data = await extensionsApi.list({ format: 'agentskills' });
      setSkills(Array.isArray(data) ? data : []);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleToggle = async (skill: ExtensionInfo) => {
    try {
      if (skill.status === 'enabled') {
        await extensionsApi.disable(skill.id);
        toast.success(`Skill "${skill.name}" disabled`);
      } else {
        await extensionsApi.enable(skill.id);
        toast.success(`Skill "${skill.name}" enabled`);
      }
      fetchSkills();
    } catch {
      toast.error('Failed to toggle skill');
    }
  };

  const handleUninstall = async (id: string) => {
    try {
      await extensionsApi.uninstall(id);
      toast.success('Skill uninstalled');
      setSelectedSkill(null);
      fetchSkills();
    } catch {
      toast.error('Failed to uninstall skill');
    }
  };

  const handleScan = async () => {
    try {
      const result = await extensionsApi.scan();
      if (result.installed > 0) {
        toast.success(`Found ${result.installed} new package(s)`);
      } else {
        toast.info('No new skills found');
      }
      fetchSkills();
    } catch {
      toast.error('Scan failed');
    }
  };

  const [showCreator, setShowCreator] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (fileInputRef.current) fileInputRef.current.value = '';

    setIsUploading(true);
    try {
      const result = await extensionsApi.upload(file);
      toast.success(result.message || `Uploaded "${file.name}"`);
      fetchSkills();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const filteredSkills = skills.filter((s) => {
    if (filter === 'enabled') return s.status === 'enabled';
    if (filter === 'disabled') return s.status === 'disabled';
    return true;
  });

  const stats = {
    total: skills.length,
    enabled: skills.filter((s) => s.status === 'enabled').length,
    disabled: skills.filter((s) => s.status === 'disabled').length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Skills
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            AgentSkills.io open standard — instruction-based knowledge for your AI
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleScan}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            title="Scan directories for SKILL.md files"
          >
            <FolderOpen className="w-4 h-4" />
            Scan
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.json,.zip"
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors disabled:opacity-50"
            title="Upload skill file (.md, .json, or .zip)"
          >
            <Upload className="w-4 h-4" />
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
          <button
            onClick={() => setShowCreator(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white hover:bg-primary/90 rounded-lg transition-colors"
            title="Create a new skill with AI"
          >
            <Sparkles className="w-4 h-4" />
            Create
          </button>
          <button
            onClick={() => {
              setIsLoading(true);
              fetchSkills();
            }}
            className="p-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Stats Bar */}
      {stats.total > 0 && (
        <div className="px-6 py-3 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-text-muted dark:text-dark-text-muted">Total:</span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">
                {stats.total}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-text-muted dark:text-dark-text-muted">Active:</span>
              <span className="font-medium text-success">{stats.enabled}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-text-muted" />
              <span className="text-text-muted dark:text-dark-text-muted">Inactive:</span>
              <span className="font-medium text-text-secondary dark:text-dark-text-secondary">
                {stats.disabled}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="px-6 py-3 border-b border-border dark:border-dark-border">
        <div className="flex gap-2">
          {(['all', 'enabled', 'disabled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <LoadingSpinner message="Loading skills..." />
        ) : filteredSkills.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={`No skills ${filter !== 'all' ? filter : 'installed'}`}
            description={
              filter === 'all'
                ? 'Place SKILL.md folders in the skills directory, then click "Scan" to discover them. Skills follow the AgentSkills.io open standard.'
                : `No ${filter} skills found.`
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={() => handleToggle(skill)}
                onClick={() => setSelectedSkill(skill)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onToggle={() => handleToggle(selectedSkill)}
          onUninstall={() => handleUninstall(selectedSkill.id)}
        />
      )}

      {/* Skill Creator Modal */}
      {showCreator && (
        <SkillCreatorModal
          onClose={() => setShowCreator(false)}
          onInstalled={() => {
            setShowCreator(false);
            fetchSkills();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

function SkillCard({
  skill,
  onToggle,
  onClick,
}: {
  skill: ExtensionInfo;
  onToggle: () => void;
  onClick: () => void;
}) {
  const isEnabled = skill.status === 'enabled';
  const categoryColor = CATEGORY_COLORS[skill.category] ?? CATEGORY_COLORS.other;
  const security = skill.manifest._security;

  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-start justify-between mb-3">
        <button onClick={onClick} className="flex items-start gap-3 text-left flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
            {skill.icon ? (
              <span className="text-lg">{skill.icon}</span>
            ) : (
              <BookOpen className="w-5 h-5 text-violet-500" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
              {skill.name}
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted flex items-center gap-1">
              <Globe className="w-3 h-3" />
              AgentSkills.io
            </p>
          </div>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`p-2 rounded-lg transition-colors shrink-0 ${
            isEnabled
              ? 'bg-success/10 text-success hover:bg-success/20'
              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted hover:bg-bg-primary dark:hover:bg-dark-bg-primary'
          }`}
          title={isEnabled ? 'Disable skill' : 'Enable skill'}
        >
          <Power className="w-4 h-4" />
        </button>
      </div>

      <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 mb-3">
        {skill.description || skill.manifest.description}
      </p>

      {/* Category & Tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {skill.category && (
          <span className={`px-2 py-0.5 text-xs rounded-full ${categoryColor}`}>
            {skill.category.charAt(0).toUpperCase() + skill.category.slice(1)}
          </span>
        )}
        {skill.manifest.tags?.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-600 dark:text-gray-400"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Status & Info */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span
            className={`px-2 py-0.5 rounded-full ${
              isEnabled
                ? 'bg-success/20 text-success'
                : 'bg-text-muted/20 text-text-muted dark:text-dark-text-muted'
            }`}
          >
            {skill.status}
          </span>
          {security && security.riskLevel !== 'low' && (
            <span
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-current/10 ${RISK_COLORS[security.riskLevel] || ''}`}
              title={`Security: ${security.riskLevel} risk${security.warnings?.length ? ` (${security.warnings.length} warning${security.warnings.length !== 1 ? 's' : ''})` : ''}`}
            >
              <Shield className="w-3 h-3" />
              {security.riskLevel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-text-muted dark:text-dark-text-muted">
          {skill.manifest.script_paths && skill.manifest.script_paths.length > 0 && (
            <span className="flex items-center gap-1">
              <Code className="w-3 h-3" />
              {skill.manifest.script_paths.length}
            </span>
          )}
          {skill.manifest.instructions && (
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />~{Math.ceil(skill.manifest.instructions.length / 4)}{' '}
              tok
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill Detail Modal
// ---------------------------------------------------------------------------

function SkillDetailModal({
  skill,
  onClose,
  onToggle,
  onUninstall,
}: {
  skill: ExtensionInfo;
  onClose: () => void;
  onToggle: () => void;
  onUninstall: () => void;
}) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'overview' | 'security'>('overview');
  const [showInstructions, setShowInstructions] = useState(true);
  const instructions = skill.manifest.instructions || skill.manifest.system_prompt || '';
  const security = skill.manifest._security;

  const [auditResult, setAuditResult] = useState<ExtensionAuditResult | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);

  const runAudit = useCallback(async () => {
    setIsAuditing(true);
    try {
      const result = await extensionsApi.audit(skill.id);
      setAuditResult(result);
      if (result.llmError) {
        toast.warning(`Audit completed with LLM error: ${result.llmError}`);
      } else {
        toast.success('Security audit completed');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setIsAuditing(false);
    }
  }, [skill.id, toast]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border dark:border-dark-border">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center">
                {skill.icon ? (
                  <span className="text-2xl">{skill.icon}</span>
                ) : (
                  <BookOpen className="w-6 h-6 text-violet-500" />
                )}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                  {skill.name}
                </h2>
                <p className="text-xs text-text-muted dark:text-dark-text-muted flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  AgentSkills.io &middot; v{skill.version}
                  {skill.manifest.license && <> &middot; {skill.manifest.license}</>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {security && security.riskLevel !== 'low' && (
                <span
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${RISK_BADGE[security.riskLevel]?.color ?? ''}`}
                >
                  <Shield className="w-3 h-3" />
                  {RISK_BADGE[security.riskLevel]?.label ?? security.riskLevel}
                </span>
              )}
              <button
                onClick={onClose}
                className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-3">
            {skill.description || skill.manifest.description}
          </p>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-border dark:border-dark-border">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'security'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Security
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Compatibility */}
              {skill.manifest.compatibility && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    <strong>Requirements:</strong> {skill.manifest.compatibility}
                  </p>
                </div>
              )}

              {/* Instructions */}
              {instructions && (
                <div>
                  <button
                    onClick={() => setShowInstructions(!showInstructions)}
                    className="flex items-center gap-2 text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2"
                  >
                    {showInstructions ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <FileText className="w-4 h-4" />
                    Instructions (~{Math.ceil(instructions.length / 4)} tokens)
                  </button>
                  {showInstructions && (
                    <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border max-h-64 overflow-y-auto">
                      <pre className="text-xs text-text-secondary dark:text-dark-text-secondary whitespace-pre-wrap font-mono">
                        {instructions}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Scripts */}
              {skill.manifest.script_paths && skill.manifest.script_paths.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                    <Code className="w-4 h-4" />
                    Scripts ({skill.manifest.script_paths.length})
                  </h4>
                  <div className="space-y-1">
                    {skill.manifest.script_paths.map((path) => (
                      <div
                        key={path}
                        className="px-3 py-1.5 bg-bg-secondary dark:bg-dark-bg-secondary rounded text-xs font-mono text-text-secondary dark:text-dark-text-secondary"
                      >
                        {path}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* References */}
              {skill.manifest.reference_paths && skill.manifest.reference_paths.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    References ({skill.manifest.reference_paths.length})
                  </h4>
                  <div className="space-y-1">
                    {skill.manifest.reference_paths.map((path) => (
                      <div
                        key={path}
                        className="px-3 py-1.5 bg-bg-secondary dark:bg-dark-bg-secondary rounded text-xs font-mono text-text-secondary dark:text-dark-text-secondary"
                      >
                        {path}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Allowed Tools */}
              {skill.manifest.allowed_tools && skill.manifest.allowed_tools.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                    Pre-approved Tools
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {skill.manifest.allowed_tools.map((tool) => (
                      <span
                        key={tool}
                        className="px-2 py-0.5 text-xs rounded-full bg-success/15 text-success font-mono"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              {/* Static Analysis */}
              <div>
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Static Analysis
                </h4>
                {security ? (
                  <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-muted dark:text-dark-text-muted">
                        Risk Level
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${RISK_BADGE[security.riskLevel]?.color ?? 'bg-gray-500/15 text-gray-500'}`}
                      >
                        {RISK_BADGE[security.riskLevel]?.label ?? security.riskLevel}
                      </span>
                    </div>
                    {security.warnings?.length > 0 && (
                      <div>
                        <span className="text-xs text-text-muted dark:text-dark-text-muted">
                          Warnings
                        </span>
                        <ul className="mt-1 space-y-1">
                          {security.warnings.map((w, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-warning">
                              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {security.undeclaredTools?.length > 0 && (
                      <div>
                        <span className="text-xs text-text-muted dark:text-dark-text-muted">
                          Undeclared Tools Referenced
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {security.undeclaredTools.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 text-xs rounded bg-warning/10 text-warning font-mono"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {security.warnings?.length === 0 && security.undeclaredTools?.length === 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-success">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        No security issues detected
                      </div>
                    )}
                    {security.auditedAt && (
                      <p className="text-xs text-text-muted dark:text-dark-text-muted">
                        Audited {new Date(security.auditedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-xs text-text-muted dark:text-dark-text-muted">
                    No static analysis data available. Re-install the skill to generate it.
                  </div>
                )}
              </div>

              {/* LLM Deep Audit */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary flex items-center gap-2">
                    <Brain className="w-4 h-4" />
                    AI Deep Audit
                  </h4>
                  <button
                    onClick={runAudit}
                    disabled={isAuditing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isAuditing ? (
                      <>
                        <LoadingSpinner size="sm" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Brain className="w-3.5 h-3.5" />
                        {auditResult ? 'Re-run Audit' : 'Run Audit'}
                      </>
                    )}
                  </button>
                </div>

                {!auditResult && !isAuditing && (
                  <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-center">
                    <Brain className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      Run an AI-powered deep security audit to analyze this skill's instructions,
                      capabilities, and potential risks.
                    </p>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                      Requires a configured AI provider.
                    </p>
                  </div>
                )}

                {isAuditing && !auditResult && (
                  <div className="p-6 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg flex flex-col items-center">
                    <LoadingSpinner size="md" />
                    <p className="text-sm text-text-muted dark:text-dark-text-muted mt-3">
                      Analyzing skill security with AI...
                    </p>
                  </div>
                )}

                {auditResult && <AuditResultView result={auditResult} />}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex items-center justify-between">
          <button
            onClick={onUninstall}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-error hover:bg-error/10 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Uninstall
          </button>
          <button
            onClick={onToggle}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              skill.status === 'enabled'
                ? 'bg-text-muted/10 text-text-secondary hover:bg-text-muted/20'
                : 'bg-primary text-white hover:bg-primary/90'
            }`}
          >
            {skill.status === 'enabled' ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Result View (shared with ExtensionDetailModal pattern)
// ---------------------------------------------------------------------------

function AuditResultView({ result }: { result: ExtensionAuditResult }) {
  const llm = result.llmAnalysis;
  const staticA = result.staticAnalysis;

  return (
    <div className="space-y-4">
      {/* LLM Error */}
      {result.llmError && (
        <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-medium text-warning">AI Analysis Unavailable</span>
              <p className="text-xs text-warning/80 mt-0.5">{result.llmError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Static Result Summary */}
      <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
            Static Analysis
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${RISK_BADGE[staticA.riskLevel]?.color ?? ''}`}
          >
            {RISK_BADGE[staticA.riskLevel]?.label ?? staticA.riskLevel}
          </span>
        </div>
        {staticA.warnings.length > 0 && (
          <ul className="space-y-1">
            {staticA.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        )}
        {staticA.warnings.length === 0 && (
          <div className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="w-3.5 h-3.5" />
            No issues found
          </div>
        )}
      </div>

      {/* LLM Audit Results */}
      {llm && (
        <>
          {/* Verdict + Trust Score */}
          <div
            className={`p-4 rounded-lg border ${VERDICT_STYLE[llm.verdict]?.bg ?? 'bg-bg-tertiary border-border'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {llm.verdict === 'safe' && <CheckCircle2 className="w-5 h-5 text-success" />}
                {llm.verdict === 'caution' && <AlertTriangle className="w-5 h-5 text-warning" />}
                {llm.verdict === 'unsafe' && <AlertCircle className="w-5 h-5 text-error" />}
                <span
                  className={`text-sm font-semibold ${VERDICT_STYLE[llm.verdict]?.color ?? ''}`}
                >
                  {VERDICT_STYLE[llm.verdict]?.label ?? llm.verdict}
                </span>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                  {llm.trustScore}
                </span>
                <span className="text-xs text-text-muted dark:text-dark-text-muted">/100</span>
              </div>
            </div>
            <p className="text-xs text-text-secondary dark:text-dark-text-secondary">
              {llm.reasoning}
            </p>
          </div>

          {/* Summary */}
          <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
            <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
              Summary
            </span>
            <p className="text-sm text-text-primary dark:text-dark-text-primary mt-1">
              {llm.summary}
            </p>
          </div>

          {/* Capabilities / Data Access / External */}
          <div className="grid grid-cols-1 gap-3">
            {llm.capabilities.length > 0 && (
              <DetailList title="Capabilities" items={llm.capabilities} />
            )}
            {llm.dataAccess.length > 0 && <DetailList title="Data Access" items={llm.dataAccess} />}
            {llm.externalCommunication.length > 0 && (
              <DetailList title="External Communication" items={llm.externalCommunication} />
            )}
          </div>

          {/* Risks */}
          {llm.risks.length > 0 && (
            <div>
              <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
                Identified Risks ({llm.risks.length})
              </span>
              <div className="mt-2 space-y-2">
                {llm.risks.map((risk, i) => (
                  <div key={i} className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <div className="flex items-start gap-2">
                      {risk.severity === 'critical' || risk.severity === 'high' ? (
                        <AlertCircle className="w-4 h-4 text-error shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-primary dark:text-dark-text-primary">
                            {risk.description}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${RISK_BADGE[risk.severity]?.color ?? ''}`}
                          >
                            {risk.severity}
                          </span>
                        </div>
                        {risk.mitigation && (
                          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                            Mitigation: {risk.mitigation}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {llm.risks.length === 0 && (
            <div className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="w-4 h-4" />
              No risks identified by AI analysis
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
      <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
        {title}
      </span>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, i) => (
          <li
            key={i}
            className="text-xs text-text-primary dark:text-dark-text-primary flex items-start gap-1.5"
          >
            <span className="text-text-muted dark:text-dark-text-muted mt-0.5">-</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill Creator Modal
// ---------------------------------------------------------------------------

function SkillCreatorModal({
  onClose,
  onInstalled,
}: {
  onClose: () => void;
  onInstalled: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<'describe' | 'preview'>('describe');
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [generatedName, setGeneratedName] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) return;

    setIsGenerating(true);
    try {
      const result = await extensionsApi.generateSkill(description.trim());
      setGeneratedContent(result.content);
      setGeneratedName(result.name);

      if (!result.validation.valid) {
        toast.warning(`Generated with warnings: ${result.validation.errors.join(', ')}`);
      }

      setStep('preview');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleInstall = async () => {
    if (!generatedContent.trim()) return;

    setIsInstalling(true);
    try {
      const blob = new Blob([generatedContent], { type: 'text/markdown' });
      const file = new File([blob], 'SKILL.md', { type: 'text/markdown' });
      await extensionsApi.upload(file);
      toast.success(`Skill "${generatedName}" installed`);
      onInstalled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border dark:border-dark-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Create Skill with AI
              </h2>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                {step === 'describe'
                  ? 'Describe what the skill should do'
                  : 'Review and install the generated skill'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'describe' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  What should this skill do?
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., A code review skill that checks for security vulnerabilities, performance issues, and code quality best practices..."
                  rows={6}
                  className="w-full px-3 py-2 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                The AI will generate a SKILL.md file following the AgentSkills.io open standard. Be
                specific about the workflow steps, checks, and output format you want.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                  Generated: {generatedName}
                </h3>
                <button
                  onClick={() => setStep('describe')}
                  className="text-xs text-primary hover:underline"
                >
                  Back to description
                </button>
              </div>
              <textarea
                value={generatedContent}
                onChange={(e) => setGeneratedContent(e.target.value)}
                rows={20}
                className="w-full px-3 py-2 text-xs font-mono bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          {step === 'describe' ? (
            <button
              onClick={handleGenerate}
              disabled={!description.trim() || isGenerating}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {isGenerating ? 'Generating...' : 'Generate with AI'}
            </button>
          ) : (
            <button
              onClick={handleInstall}
              disabled={!generatedContent.trim() || isInstalling}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
            >
              <BookOpen className="w-4 h-4" />
              {isInstalling ? 'Installing...' : 'Install Skill'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
