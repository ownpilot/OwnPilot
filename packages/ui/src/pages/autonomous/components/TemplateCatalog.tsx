/**
 * TemplateCatalog — browsable template gallery with categories,
 * search, and rich preview cards for solo agents + crew templates.
 */

import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, Users } from '../../../components/icons';
import type { CrewTemplate } from '../../../api/endpoints/souls';
import {
  AGENT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type AgentTemplate,
  type TemplateCategory,
} from '../data/agent-templates';
import { cronToHuman, PATTERN_LABELS } from '../helpers';

interface Props {
  onSelect: (template: AgentTemplate) => void;
  crewTemplates: CrewTemplate[];
  onDeployCrew: (templateId: string) => void;
}

export function TemplateCatalog({ onSelect, crewTemplates, onDeployCrew }: Props) {
  const [category, setCategory] = useState<TemplateCategory | 'all' | 'crews'>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (category === 'crews') return [];
    return AGENT_TEMPLATES.filter((t) => {
      if (category !== 'all' && t.category !== category) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.includes(q))
        );
      }
      return true;
    });
  }, [category, search]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-surface dark:bg-dark-surface text-text-primary dark:text-dark-text-primary placeholder-text-muted"
        />
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATE_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              category === cat.key
                ? 'bg-primary text-white'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10'
            }`}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
        {crewTemplates.length > 0 && (
          <button
            onClick={() => setCategory('crews')}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              category === 'crews'
                ? 'bg-primary text-white'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10'
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" />
              Crew Templates
            </span>
          </button>
        )}
      </div>

      {/* Solo agent templates grid */}
      {category !== 'crews' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((template) => {
            const isExpanded = expandedId === template.id;
            return (
              <div
                key={template.id}
                className="border border-border dark:border-dark-border rounded-xl p-4 bg-surface dark:bg-dark-surface hover:shadow-sm transition-shadow"
              >
                {/* Card header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xl">{template.emoji}</span>
                    <div className="min-w-0">
                      <h4 className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate">
                        {template.name}
                      </h4>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full ${
                          template.kind === 'soul'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-text-muted/10 text-text-muted dark:text-dark-text-muted'
                        }`}
                      >
                        {template.kind === 'soul' ? 'Soul' : 'Background'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="mt-2 text-xs text-text-muted dark:text-dark-text-muted line-clamp-2">
                  {template.description}
                </p>

                {/* Schedule + cost */}
                <div className="mt-2 flex items-center gap-3 text-xs text-text-muted dark:text-dark-text-muted">
                  <span>
                    {template.heartbeatInterval
                      ? cronToHuman(template.heartbeatInterval)
                      : template.bgMode === 'event'
                        ? 'On demand'
                        : template.bgMode === 'interval' && template.bgIntervalMs
                          ? `Every ${Math.round(template.bgIntervalMs / 60_000)}m`
                          : 'Continuous'}
                  </span>
                  <span>{template.estimatedCost}</span>
                </div>

                {/* Expandable details */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : template.id)}
                  className="mt-2 flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="w-3 h-3" /> Less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" /> Details
                    </>
                  )}
                </button>

                {isExpanded && (
                  <div className="mt-2 space-y-2 border-t border-border dark:border-dark-border pt-2">
                    <div>
                      <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                        When to use:
                      </p>
                      <ul className="text-xs text-text-muted dark:text-dark-text-muted space-y-0.5">
                        {template.useCases.map((uc, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span className="text-primary shrink-0">-</span> {uc}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {template.tools.map((tool) => (
                        <span
                          key={tool}
                          className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
                        >
                          {tool.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Use button */}
                <button
                  onClick={() => onSelect(template)}
                  className="mt-3 w-full px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
                >
                  Use This Template
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-8 text-sm text-text-muted dark:text-dark-text-muted">
              No templates match your search. Try a different keyword or category.
            </div>
          )}
        </div>
      )}

      {/* Crew templates */}
      {category === 'crews' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {crewTemplates.map((crew) => (
            <div
              key={crew.id}
              className="border border-border dark:border-dark-border rounded-xl p-4 bg-surface dark:bg-dark-surface"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-xl">{crew.emoji}</span>
                <div>
                  <h4 className="font-medium text-sm text-text-primary dark:text-dark-text-primary">
                    {crew.name}
                  </h4>
                  <span className="text-xs text-text-muted dark:text-dark-text-muted">
                    {crew.agents?.length ?? 0} agents
                    {crew.coordinationPattern &&
                      ` · ${PATTERN_LABELS[crew.coordinationPattern] || crew.coordinationPattern}`}
                  </span>
                </div>
              </div>
              {crew.description && (
                <p className="mt-2 text-xs text-text-muted dark:text-dark-text-muted">
                  {crew.description}
                </p>
              )}
              {crew.agents && crew.agents.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {crew.agents.map((agent, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                    >
                      {agent.identity?.emoji} {agent.identity?.name}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => onDeployCrew(crew.id)}
                className="mt-3 w-full px-3 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors"
              >
                Deploy Crew
              </button>
            </div>
          ))}
          {crewTemplates.length === 0 && (
            <div className="col-span-full text-center py-8 text-sm text-text-muted dark:text-dark-text-muted">
              No crew templates available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
