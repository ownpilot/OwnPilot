import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Sparkles,
  Download,
  Puzzle,
  Globe,
  Code,
  Zap,
  CheckCircle2,
  Search,
  Plus,
  Terminal,
  Brain,
  Wrench,
} from '../../components/icons';

// =============================================================================
// Data
// =============================================================================

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: BookOpen,
    color: 'text-primary bg-primary/10',
    title: 'SKILL.md Standard',
    description:
      'Skills use the open AgentSkills.io format — plain markdown files that any AI agent can understand.',
  },
  {
    icon: Puzzle,
    color: 'text-violet-500 bg-violet-500/10',
    title: 'Plug & Play',
    description:
      'Install a skill and it becomes available to your AI instantly. No code changes, no restarts required.',
  },
  {
    icon: Globe,
    color: 'text-emerald-500 bg-emerald-500/10',
    title: 'npm Registry',
    description:
      'Discover and install community skills directly from npm. Search by keyword, author, or category.',
  },
  {
    icon: Wrench,
    color: 'text-orange-500 bg-orange-500/10',
    title: 'Built-in Tools',
    description:
      'Skills can expose custom tools, API integrations, and data transformations your AI can call.',
  },
];

interface QuickAction {
  tab: 'installed' | 'discover' | 'create';
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  color: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    tab: 'installed',
    icon: Terminal,
    label: 'View Installed',
    description: 'Manage, enable, or remove your current skills',
    color: 'border-primary/30 hover:border-primary/60',
  },
  {
    tab: 'discover',
    icon: Search,
    label: 'Browse Registry',
    description: 'Search npm for community-built skills',
    color: 'border-emerald-500/30 hover:border-emerald-500/60',
  },
  {
    tab: 'create',
    icon: Plus,
    label: 'Create a Skill',
    description: 'Build a new skill with the guided wizard',
    color: 'border-violet-500/30 hover:border-violet-500/60',
  },
];

interface Step {
  n: number;
  title: string;
  detail: string;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: 'Find or create a skill',
    detail:
      'Browse the npm registry in the Discover tab, or build your own with the Create wizard. Skills are simple SKILL.md markdown files.',
  },
  {
    n: 2,
    title: 'Install with one click',
    detail:
      'Click Install on any discovered package, drag-and-drop a .skill file, or paste a SKILL.md URL. The skill is parsed and stored instantly.',
  },
  {
    n: 3,
    title: 'Your AI gains new abilities',
    detail:
      'Installed skills are injected into your AI agent\'s context automatically. Ask it to use the new capability — it just works.',
  },
  {
    n: 4,
    title: 'Test, evaluate, and optimize',
    detail:
      'Use the built-in eval runner to grade skill quality, then optimize descriptions with AI for better triggering accuracy.',
  },
];

const SKILL_EXAMPLES = [
  { emoji: '📧', name: 'Email Drafting', desc: 'Compose professional emails in your style' },
  { emoji: '📊', name: 'Data Analysis', desc: 'Parse CSVs, generate charts, find trends' },
  { emoji: '🔍', name: 'Web Research', desc: 'Search, summarize, and cite sources' },
  { emoji: '📝', name: 'Meeting Notes', desc: 'Summarize transcripts into action items' },
  { emoji: '🛠️', name: 'DevOps', desc: 'Monitor services, parse logs, run deploys' },
  { emoji: '🌐', name: 'Translation', desc: 'Translate content across 50+ languages' },
];

// =============================================================================
// Component
// =============================================================================

export function HomeTab() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const goToTab = (tab: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-10 overflow-y-auto h-full">
      {/* Hero */}
      <div className="text-center space-y-3">
        <div className="flex justify-center gap-3 mb-4">
          <span className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-primary" />
          </span>
          <span className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center">
            <Brain className="w-6 h-6 text-violet-500" />
          </span>
          <span className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <Code className="w-6 h-6 text-emerald-500" />
          </span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
          Teach Your AI New Skills
        </h1>
        <p className="text-text-secondary dark:text-dark-text-secondary max-w-xl mx-auto leading-relaxed">
          Skills are portable instruction sets that give your AI agent new capabilities — from email
          drafting to data analysis. Install from npm or build your own.
        </p>
        <button
          onClick={() => goToTab('discover')}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors mt-2"
        >
          <Download className="w-4 h-4" />
          Browse Skills
        </button>
      </div>

      {/* Features grid */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          What Are Skills?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="border border-border dark:border-dark-border rounded-xl p-4 space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${f.color}`}
                >
                  <f.icon className="w-4 h-4" />
                </span>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {f.title}
                </span>
              </div>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary leading-relaxed">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Skill examples */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          Popular Skill Ideas
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SKILL_EXAMPLES.map((ex) => (
            <div
              key={ex.name}
              className="flex items-center gap-2.5 border border-border dark:border-dark-border rounded-lg px-3 py-2.5"
            >
              <span className="text-lg">{ex.emoji}</span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">
                  {ex.name}
                </p>
                <p className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
                  {ex.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Getting started steps */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          Getting Started
        </h2>
        <div className="space-y-3">
          {STEPS.map((step) => (
            <div key={step.n} className="flex gap-4">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {step.n}
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {step.title}
                </p>
                <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5 leading-relaxed">
                  {step.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.tab}
              onClick={() => goToTab(qa.tab)}
              className={`border-2 ${qa.color} rounded-xl p-4 text-left transition-colors group`}
            >
              <qa.icon className="w-5 h-5 text-text-secondary dark:text-dark-text-secondary mb-2 group-hover:text-primary transition-colors" />
              <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                {qa.label}
              </p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                {qa.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Format info box */}
      <div className="border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-2">
          <BookOpen className="w-4 h-4" />
          About the SKILL.md Format
        </p>
        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          Skills follow the open{' '}
          <span className="font-semibold">AgentSkills.io</span> standard — a plain markdown file
          with YAML frontmatter for metadata and markdown body for instructions. OwnPilot also
          supports its own native format with richer tool definitions and multi-section layouts.
          Both formats are fully supported.
        </p>
      </div>

      {/* CTA footer */}
      <div className="text-center pb-4">
        <button
          onClick={() => goToTab('create')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Create Your First Skill
        </button>
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
          The wizard guides you through writing, testing, and packaging a skill.
        </p>
      </div>
    </div>
  );
}
