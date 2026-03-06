import { BookOpen, Wrench } from '../../../components/icons';

export type SkillFormat = 'agentskills' | 'ownpilot';

interface FormatStepProps {
  selected: SkillFormat | null;
  onSelect: (format: SkillFormat) => void;
  onNext: () => void;
}

const OPTIONS: {
  id: SkillFormat;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  bullets: string[];
  badgeColor: string;
  badgeLabel: string;
}[] = [
  {
    id: 'agentskills',
    icon: BookOpen,
    title: 'SKILL.md',
    subtitle: 'AgentSkills.io open standard',
    bullets: [
      'Instruction-based knowledge package',
      'Plain markdown — no code required',
      'Portable, shareable, version-controlled',
      'Industry standard (AgentSkills.io)',
    ],
    badgeColor: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
    badgeLabel: 'Recommended',
  },
  {
    id: 'ownpilot',
    icon: Wrench,
    title: 'Extension',
    subtitle: 'OwnPilot native format',
    bullets: [
      'Custom JS tool code + triggers',
      'Full access to built-in tool library',
      'JSON manifest + inline code',
      'Advanced automation capabilities',
    ],
    badgeColor: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
    badgeLabel: 'Advanced',
  },
];

export function FormatStep({ selected, onSelect, onNext }: FormatStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          Choose a format
        </h3>
        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
          Select the format that best fits your use case.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = selected === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={`text-left p-5 rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border dark:border-dark-border hover:border-primary/40'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${opt.badgeColor}`}>
                  {opt.badgeLabel}
                </span>
              </div>
              <h4 className="font-semibold text-text-primary dark:text-dark-text-primary">
                {opt.title}
              </h4>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 mb-3">
                {opt.subtitle}
              </p>
              <ul className="space-y-1">
                {opt.bullets.map((b) => (
                  <li
                    key={b}
                    className="text-xs text-text-secondary dark:text-dark-text-secondary flex items-start gap-1.5"
                  >
                    <span className="text-primary mt-0.5">•</span>
                    {b}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!selected}
          className="px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
