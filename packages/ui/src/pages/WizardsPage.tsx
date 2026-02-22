/**
 * Wizards Page — Setup Wizard Launcher
 *
 * Card grid showing available setup wizards with completion status.
 * Each card links to a step-by-step wizard flow.
 */

import { useNavigate } from 'react-router-dom';
import {
  Key,
  Telegram,
  Wrench,
  Check,
  Sparkles,
  Bot,
  Code,
  GitBranch,
  Target,
  Zap,
  Link,
} from '../components/icons';

// ============================================================================
// Wizard Definitions
// ============================================================================

interface WizardDef {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  time: string;
  color: string;
}

const WIZARDS: WizardDef[] = [
  {
    id: 'ai-provider',
    title: 'AI Provider Setup',
    description: 'Connect an AI provider like OpenAI or Anthropic and set your default model.',
    icon: Key,
    time: '~2 min',
    color: 'text-blue-500',
  },
  {
    id: 'telegram',
    title: 'Telegram Channel',
    description: 'Connect a Telegram bot so you can chat with your AI from your phone.',
    icon: Telegram,
    time: '~3 min',
    color: 'text-sky-500',
  },
  {
    id: 'mcp-server',
    title: 'MCP Server',
    description: 'Add an MCP server to extend your AI with external tools and services.',
    icon: Wrench,
    time: '~2 min',
    color: 'text-purple-500',
  },
  {
    id: 'agent',
    title: 'Create AI Agent',
    description: 'Build a custom AI agent with its own personality, model, and tool access.',
    icon: Bot,
    time: '~3 min',
    color: 'text-emerald-500',
  },
  {
    id: 'custom-tool',
    title: 'Custom Tool',
    description: 'Write a JavaScript tool that your AI can call during conversations.',
    icon: Code,
    time: '~5 min',
    color: 'text-orange-500',
  },
  {
    id: 'workflow',
    title: 'Create Workflow',
    description: 'Build an automation workflow with connected steps and AI-powered actions.',
    icon: GitBranch,
    time: '~3 min',
    color: 'text-indigo-500',
  },
  {
    id: 'goal',
    title: 'Set a Goal',
    description: 'Define a personal or professional goal and break it into actionable steps.',
    icon: Target,
    time: '~2 min',
    color: 'text-rose-500',
  },
  {
    id: 'trigger',
    title: 'Create Trigger',
    description: 'Set up scheduled or event-based automation that fires actions automatically.',
    icon: Zap,
    time: '~2 min',
    color: 'text-amber-500',
  },
  {
    id: 'connected-app',
    title: 'Connect an App',
    description: 'Link a third-party service like Google, GitHub, or Slack via OAuth.',
    icon: Link,
    time: '~3 min',
    color: 'text-teal-500',
  },
];

function isCompleted(wizardId: string): boolean {
  return localStorage.getItem(`ownpilot-wizard-${wizardId}`) === 'true';
}

// ============================================================================
// Component
// ============================================================================

export function WizardsPage() {
  const navigate = useNavigate();

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Sparkles className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
          Setup Wizards
        </h1>
      </div>
      <p className="text-text-muted dark:text-dark-text-muted mb-8">
        Step-by-step guides to get OwnPilot fully configured. Each wizard walks you through the
        setup process.
      </p>

      {/* Wizard Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {WIZARDS.map((w) => {
          const completed = isCompleted(w.id);
          const Icon = w.icon;
          return (
            <button
              key={w.id}
              onClick={() => navigate(`/wizards/${w.id}`)}
              className="group text-left p-6 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary hover:border-primary/50 dark:hover:border-primary/50 hover:shadow-md transition-all"
            >
              {/* Icon + Badge */}
              <div className="flex items-start justify-between mb-4">
                <div
                  className={`p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary ${w.color}`}
                >
                  <Icon className="w-6 h-6" />
                </div>
                {completed && (
                  <span className="flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-1 rounded-full">
                    <Check className="w-3 h-3" />
                    Done
                  </span>
                )}
              </div>

              {/* Title */}
              <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary mb-1 group-hover:text-primary transition-colors">
                {w.title}
              </h3>

              {/* Description */}
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4 line-clamp-2">
                {w.description}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted dark:text-dark-text-muted">{w.time}</span>
                <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  {completed ? 'Run Again' : 'Start'} &rarr;
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
