/**
 * HelpPanel — Documentation and guidance for the Autonomous Agents system
 */

import { X, BookOpen, Heart, Users, Zap, Brain, MessageSquare } from '../../../components/icons';

interface Props {
  onClose: () => void;
}

export function HelpPanel({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-2xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Understanding Autonomous Agents
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Core Concepts */}
          <section>
            <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary mb-3">
              What Are Autonomous Agents?
            </h3>
            <p className="text-sm text-text-muted dark:text-dark-text-muted leading-relaxed">
              Autonomous agents are AI assistants that work independently on your behalf. Unlike
              regular chat agents that wait for your messages, these agents wake up on a schedule,
              perform tasks, and report back to you. Think of them as digital employees with
              specific roles and responsibilities.
            </p>
          </section>

          {/* Two Types */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Heart className="w-4 h-4 text-primary" />
                <h4 className="font-medium text-text-primary dark:text-dark-text-primary">
                  Soul Agents
                </h4>
              </div>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Rich personalities with identity, purpose, and scheduled heartbeats. Ideal for
                ongoing tasks like daily briefings, research monitoring, or content creation.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
                <h4 className="font-medium text-text-primary dark:text-dark-text-primary">
                  Background Agents
                </h4>
              </div>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Lightweight workers that run continuously, on intervals, or on demand. Great for
                monitoring, data processing, or event-driven tasks.
              </p>
            </div>
          </section>

          {/* Key Concepts */}
          <section>
            <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary mb-3">
              Key Concepts
            </h3>
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Brain className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    Soul
                  </h4>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">
                    A soul is the persistent identity of an agent. It includes the agent&apos;s
                    name, personality, mission, autonomy rules, and learning history. Souls evolve
                    over time based on feedback.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Heart className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    Heartbeat
                  </h4>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">
                    A heartbeat is the agent&apos;s scheduled wake-up time. Agents check their
                    inbox, run their checklist of tasks, and go back to sleep. Heartbeats use cron
                    expressions like &quot;0 9 * * *&quot; (daily at 9am).
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    Crews
                  </h4>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">
                    A crew is a team of agents that work together. Agents in a crew can send
                    messages to each other via their inbox, delegate tasks, and collaborate on
                    complex workflows.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    Inbox
                  </h4>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">
                    Each agent has an inbox for receiving messages from other agents. When one agent
                    finds something interesting, it can send a message to another agent&apos;s inbox
                    for them to read on their next heartbeat.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Tips */}
          <section className="p-4 rounded-xl bg-bg-tertiary dark:bg-dark-bg-tertiary">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-2">
              Getting Started Tips
            </h3>
            <ul className="text-xs text-text-muted dark:text-dark-text-muted space-y-1.5">
              <li className="flex gap-2">
                <span className="text-primary">1.</span>
                Start with a template — browse the catalog and pick one close to what you need
              </li>
              <li className="flex gap-2">
                <span className="text-primary">2.</span>
                Use the AI Agent Creator — describe what you want in plain language
              </li>
              <li className="flex gap-2">
                <span className="text-primary">3.</span>
                Deploy a crew for complex workflows — multiple agents working together
              </li>
              <li className="flex gap-2">
                <span className="text-primary">4.</span>
                Give feedback — praise good work or correct issues to help agents learn
              </li>
              <li className="flex gap-2">
                <span className="text-primary">5.</span>
                Monitor costs — each agent has budget limits you can configure
              </li>
            </ul>
          </section>

          {/* Cost Warning */}
          <section className="p-3 rounded-lg border border-warning/30 bg-warning/10">
            <p className="text-xs text-text-secondary dark:text-dark-text-secondary">
              <strong>Cost Note:</strong> Autonomous agents consume API credits automatically when
              they run. Each agent has configurable daily/monthly budget limits. Start with lower
              autonomy levels and increase as you gain confidence.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border">
          <button
            onClick={onClose}
            className="w-full py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors text-sm"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
