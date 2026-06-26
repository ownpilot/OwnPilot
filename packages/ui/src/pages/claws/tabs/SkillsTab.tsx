import { useState, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Save, ExternalLink, Search, Info } from '../../../components/icons';
import { timeAgo } from '../utils';

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  toolCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  grantedPermissions: string[];
  instructions?: string;
}

const PERMISSION_COLORS: Record<string, string> = {
  filesystem: 'bg-blue-500/10 text-blue-600',
  network: 'bg-purple-500/10 text-purple-600',
  exec: 'bg-red-500/10 text-red-600',
  tool: 'bg-gray-500/10 text-gray-600',
  agent: 'bg-green-500/10 text-green-600',
};

function toSkillInfo(value: unknown): SkillInfo | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  return {
    id: typeof data.id === 'string' ? data.id : '',
    name: typeof data.name === 'string' ? data.name : 'Unknown skill',
    description: typeof data.description === 'string' ? data.description : '',
    version: typeof data.version === 'string' ? data.version : '',
    toolCount: typeof data.toolCount === 'number' ? data.toolCount : 0,
    status: typeof data.status === 'string' ? data.status : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    grantedPermissions: Array.isArray(data.grantedPermissions)
      ? data.grantedPermissions.filter(
          (permission): permission is string => typeof permission === 'string'
        )
      : [],
    ...(typeof data.instructions === 'string' ? { instructions: data.instructions } : {}),
  };
}

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
  const [searchQuery, setSearchQuery] = useState('');
  const [detailSkill, setDetailSkill] = useState<SkillInfo | null>(null);
  const [showAll, setShowAll] = useState(false);

  const filteredSkills = availableSkills.filter((sk) =>
    sk.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const displayedSkills = showAll ? filteredSkills : filteredSkills.slice(0, 12);

  const loadSkillDetail = useCallback(async (id: string) => {
    setDetailSkill(null);
    try {
      const { extensionsApi } = await import('../../../api/endpoints/extensions');
      const skill = await extensionsApi.getById(id);
      setDetailSkill(toSkillInfo(skill));
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Skill list */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted"
          />
        </div>
        <span className="text-xs text-text-muted shrink-0">{availableSkills.length} total</span>
      </div>

      {/* Selected skills (quick remove) */}
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-text-muted self-center">Active:</span>
          {selectedSkills.map((id) => {
            const sk = availableSkills.find((s) => s.id === id);
            return (
              <span
                key={id}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs"
              >
                {sk?.name ?? id.slice(0, 12)}
                <button
                  onClick={() => setSelectedSkills((p) => p.filter((s) => s !== id))}
                  className="hover:text-red-500"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Skill grid */}
      {availableSkills.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-text-muted dark:text-dark-text-muted">No skills installed.</p>
          <p className="text-xs text-text-muted mt-1">
            Visit the Skills Hub to install extensions.
          </p>
          <a
            href="/skills"
            className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
          >
            Go to Skills Hub <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      ) : (
        <div className="space-y-1">
          {displayedSkills.map((sk) => {
            const isSelected = selectedSkills.includes(sk.id);
            return (
              <div
                key={sk.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-primary/10 border-primary/20'
                    : 'bg-bg-secondary dark:bg-dark-bg-secondary border-transparent hover:border-border dark:hover:border-dark-border'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() =>
                    setSelectedSkills((p) =>
                      p.includes(sk.id) ? p.filter((s) => s !== sk.id) : [...p, sk.id]
                    )
                  }
                  className="w-3.5 h-3.5 rounded accent-primary shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {sk.name}
                  </p>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">
                    {sk.toolCount} tools
                  </p>
                </div>
                <button
                  onClick={() => loadSkillDetail(sk.id)}
                  className="text-xs text-primary hover:underline shrink-0"
                >
                  Detail
                </button>
              </div>
            );
          })}
          {filteredSkills.length > 12 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full py-2 text-xs text-text-muted hover:text-primary text-center"
            >
              Show {filteredSkills.length - 12} more...
            </button>
          )}
        </div>
      )}

      {/* Save button */}
      <button
        onClick={saveSkills}
        disabled={isSavingSkills}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {isSavingSkills ? 'Saving...' : `Save Skills (${selectedSkills.length} selected)`}
      </button>

      {/* Skill detail panel */}
      {detailSkill && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                {detailSkill.name}
              </h4>
              <p className="text-xs text-text-muted mt-0.5">{detailSkill.description}</p>
            </div>
            <button
              onClick={() => setDetailSkill(null)}
              className="text-xs text-text-muted hover:text-text-primary shrink-0"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-bg-primary dark:bg-dark-bg-primary rounded p-2">
              <p className="text-sm font-bold text-text-primary dark:text-dark-text-primary">
                {detailSkill.toolCount}
              </p>
              <p className="text-[10px] text-text-muted">Tools</p>
            </div>
            <div className="bg-bg-primary dark:bg-dark-bg-primary rounded p-2">
              <p className="text-sm font-bold text-text-primary dark:text-dark-text-primary">
                {detailSkill.version}
              </p>
              <p className="text-[10px] text-text-muted">Version</p>
            </div>
            <div className="bg-bg-primary dark:bg-dark-bg-primary rounded p-2">
              <p className="text-sm font-bold capitalize">{detailSkill.status}</p>
              <p className="text-[10px] text-text-muted">Status</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>Updated {timeAgo(detailSkill.updatedAt)}</span>
          </div>

          {detailSkill.grantedPermissions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Permissions
              </p>
              <div className="flex flex-wrap gap-1">
                {detailSkill.grantedPermissions.map((perm) => (
                  <span
                    key={perm}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${PERMISSION_COLORS[perm] ?? 'bg-gray-500/10 text-gray-500'}`}
                  >
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          )}

          {detailSkill.instructions && (
            <div>
              <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Instructions
              </p>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary bg-bg-primary dark:bg-dark-bg-primary rounded p-2 whitespace-pre-wrap max-h-32 overflow-y-auto">
                {detailSkill.instructions.slice(0, 500)}
                {detailSkill.instructions.length > 500 && '...'}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 border-t border-border dark:border-dark-border">
            <a
              href={`/skills?skill=${detailSkill.id}`}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open in Skills Hub <ExternalLink className="w-3 h-3" />
            </a>
            <button
              onClick={() => {
                if (selectedSkills.includes(detailSkill.id)) {
                  setSelectedSkills((p) => p.filter((s) => s !== detailSkill.id));
                } else {
                  setSelectedSkills((p) => [...p, detailSkill.id]);
                }
              }}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {selectedSkills.includes(detailSkill.id) ? 'Remove from claw' : 'Add to claw'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
