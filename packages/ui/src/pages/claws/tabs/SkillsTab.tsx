import { type Dispatch, type SetStateAction } from 'react';
import { Save } from '../../../components/icons';

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
    <div className="space-y-4">
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Select which skills (extensions) this claw can use. Each skill provides specialized
        toolsets.
      </p>
      {availableSkills.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-text-muted dark:text-dark-text-muted">No skills installed.</p>
          <p className="text-xs text-text-muted mt-1">Install skills from the Skills Hub.</p>
        </div>
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
        {isSavingSkills ? 'Saving...' : `Save Skills (${selectedSkills.length} selected)`}
      </button>
    </div>
  );
}
