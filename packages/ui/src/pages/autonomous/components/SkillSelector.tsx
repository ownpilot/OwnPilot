/**
 * SkillSelector — allow selecting which skills an agent can access
 */

import { useState, useEffect } from 'react';
import { extensionsApi } from '../../../api/endpoints/extensions';
import type { ExtensionInfo } from '../../../api/types';
import {
  Check,
  Puzzle,
  AlertCircle,
  Eye,
  X,
  FileText,
  Wrench,
  BookOpen,
} from '../../../components/icons';

interface Props {
  selectedSkills: string[];
  onChange: (skillIds: string[]) => void;
}

export function SkillSelector({ selectedSkills, onChange }: Props) {
  const [skills, setSkills] = useState<ExtensionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingSkill, setViewingSkill] = useState<ExtensionInfo | null>(null);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await extensionsApi.list();
      // Only show enabled skills/extensions
      const enabledSkills = data.filter((ext) => ext.status === 'enabled');
      setSkills(enabledSkills);
    } catch {
      setError('Failed to load skills');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSkill = (skillId: string) => {
    if (selectedSkills.includes(skillId)) {
      onChange(selectedSkills.filter((id) => id !== skillId));
    } else {
      onChange([...selectedSkills, skillId]);
    }
  };

  const selectAll = () => {
    onChange(skills.map((s) => s.id));
  };

  const selectNone = () => {
    onChange([]);
  };

  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <div className="animate-pulse text-text-muted dark:text-dark-text-muted">
          Loading skills...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-danger/10 text-danger flex items-center gap-2">
        <AlertCircle className="w-5 h-5" />
        <span>{error}</span>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="p-4 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted text-center">
        <Puzzle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No skills installed</p>
        <p className="text-xs mt-1">
          Install skills from the Extensions page to enable them for agents
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted dark:text-dark-text-muted">
          Select which skills this agent can access
        </p>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="text-xs px-2 py-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 hover:text-primary transition-colors"
          >
            Select All
          </button>
          <button
            onClick={selectNone}
            className="text-xs px-2 py-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-danger/10 hover:text-danger transition-colors"
          >
            None
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1">
        {skills.map((skill) => {
          const isSelected = selectedSkills.includes(skill.id);
          return (
            <div
              key={skill.id}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border dark:border-dark-border hover:border-primary/50'
              }`}
            >
              <button
                onClick={() => toggleSkill(skill.id)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center border ${
                    isSelected
                      ? 'bg-primary border-primary text-white'
                      : 'border-border dark:border-dark-border'
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary dark:text-dark-text-primary text-sm">
                      {skill.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        skill.manifest?.format === 'agentskills'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      }`}
                    >
                      {skill.manifest?.format === 'agentskills' ? 'Skill' : 'Extension'}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                    {skill.description || 'No description'}
                  </p>
                  {skill.toolCount > 0 && (
                    <p className="text-[10px] text-text-muted dark:text-dark-text-muted mt-0.5">
                      {skill.toolCount} tool{skill.toolCount !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </button>
              <button
                onClick={() => setViewingSkill(skill)}
                className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                title="View skill details"
              >
                <Eye className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Skill Detail Modal */}
      {viewingSkill && (
        <SkillDetailModal
          skill={viewingSkill}
          onClose={() => setViewingSkill(null)}
          isSelected={selectedSkills.includes(viewingSkill.id)}
          onToggle={() => toggleSkill(viewingSkill.id)}
        />
      )}

      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        {selectedSkills.length} of {skills.length} skills selected
      </p>
    </div>
  );
}

// =============================================================================
// Skill Detail Modal
// =============================================================================

interface SkillDetailModalProps {
  skill: ExtensionInfo;
  onClose: () => void;
  isSelected: boolean;
  onToggle: () => void;
}

function SkillDetailModal({ skill, onClose, isSelected, onToggle }: SkillDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'tools' | 'content'>('overview');
  const tools = skill.manifest?.tools || [];
  const content = skill.manifest?.instructions || skill.manifest?.docs || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl border border-border dark:border-dark-border shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Puzzle className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                {skill.name}
              </h3>
              <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                <span
                  className={`px-1.5 py-0.5 rounded-full ${
                    skill.manifest?.format === 'agentskills'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}
                >
                  {skill.manifest?.format === 'agentskills' ? 'Skill' : 'Extension'}
                </span>
                <span>v{skill.manifest?.version || skill.version || '1.0.0'}</span>
                {(skill.manifest?.author?.name || skill.authorName) && (
                  <span>by {skill.manifest?.author?.name || skill.authorName}</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 border-b border-border dark:border-dark-border">
          {[
            { id: 'overview', label: 'Overview', icon: BookOpen },
            { id: 'tools', label: `Tools (${tools.length})`, icon: Wrench },
            { id: 'content', label: 'Content', icon: FileText },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <p className="text-sm text-text-primary dark:text-dark-text-primary">
                {skill.description || 'No description available.'}
              </p>

              {skill.manifest?.keywords && skill.manifest.keywords.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2">
                    Capabilities
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {skill.manifest.keywords.map((kw: string, i: number) => (
                      <span
                        key={i}
                        className="text-xs px-2 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {skill.manifest?.tags && skill.manifest.tags.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2">
                    Tags
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {skill.manifest.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {skill.manifest?.license && (
                <div className="text-xs text-text-muted dark:text-dark-text-muted">
                  License: {skill.manifest.license}
                </div>
              )}
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="space-y-2">
              {tools.length === 0 ? (
                <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-8">
                  No tools exposed by this skill.
                </p>
              ) : (
                tools.map((tool, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg border border-border dark:border-dark-border"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Wrench className="w-3.5 h-3.5 text-primary" />
                      <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                        {tool.name}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted">
                      {tool.description || 'No description'}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'content' && (
            <div className="space-y-2">
              {content ? (
                <pre className="text-xs text-text-primary dark:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {content}
                </pre>
              ) : (
                <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-8">
                  No content available for this skill.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border dark:border-dark-border">
          <div className="text-xs text-text-muted dark:text-dark-text-muted">
            {skill.toolCount > 0 && `${skill.toolCount} tools available`}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
            >
              Close
            </button>
            <button
              onClick={onToggle}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                isSelected
                  ? 'bg-danger/10 text-danger hover:bg-danger/20'
                  : 'bg-primary text-white hover:bg-primary-dark'
              }`}
            >
              {isSelected ? (
                <>
                  <X className="w-3.5 h-3.5" /> Remove Access
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" /> Grant Access
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
