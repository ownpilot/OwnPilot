import { Settings } from '../../components/icons';
import { THRESHOLD_LABELS } from './helpers';
import type {
  PulseDirectives,
  PulseRuleDefinition,
  PulseActionType,
  RuleThresholds,
  ActionCooldowns,
} from '../../api';

interface DirectivesSectionProps {
  pulseDirectives: PulseDirectives;
  ruleDefinitions: PulseRuleDefinition[];
  actionTypes: PulseActionType[];
  directivesInstructions: string;
  onDirectivesInstructionsChange: (value: string) => void;
  onDirectivesUpdate: (updates: Partial<PulseDirectives>) => void;
  onToggleRule: (ruleId: string) => void;
  onToggleAction: (actionId: string) => void;
  onApplyTemplate: (templateName: string) => void;
}

export function DirectivesSection({
  pulseDirectives,
  ruleDefinitions,
  actionTypes,
  directivesInstructions,
  onDirectivesInstructionsChange,
  onDirectivesUpdate,
  onToggleRule,
  onToggleAction,
  onApplyTemplate,
}: DirectivesSectionProps) {
  return (
    <div className="mb-5">
      <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-3 flex items-center gap-2">
        <Settings className="w-4 h-4" />
        Pulse Directives
      </h4>

      {/* Template selector */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-text-muted dark:text-dark-text-muted">
          Template:
        </label>
        <select
          value={pulseDirectives.template}
          onChange={(e) => onApplyTemplate(e.target.value)}
          className="px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="balanced">Balanced</option>
          <option value="conservative">Conservative</option>
          <option value="proactive">Proactive</option>
          <option value="minimal">Minimal</option>
          {pulseDirectives.template === 'custom' && (
            <option value="custom">Custom</option>
          )}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Evaluation Rules */}
        <div>
          <h5 className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2 uppercase">
            Evaluation Rules
          </h5>
          <div className="space-y-1.5">
            {ruleDefinitions.map((rule) => {
              const thresholdKey = rule.thresholdKey as keyof RuleThresholds | null;
              const thresholdInfo = thresholdKey ? THRESHOLD_LABELS[thresholdKey] : null;
              const currentValue = thresholdKey ? pulseDirectives.ruleThresholds?.[thresholdKey] : null;
              return (
                <div
                  key={rule.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={!pulseDirectives.disabledRules.includes(rule.id)}
                      onChange={() => onToggleRule(rule.id)}
                      className="rounded border-border dark:border-dark-border text-primary focus:ring-primary/50"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-primary dark:text-dark-text-primary">
                        {rule.label}
                      </span>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                        {rule.description}
                      </p>
                    </div>
                  </label>
                  {thresholdInfo && currentValue != null && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <input
                        type="number"
                        min={thresholdInfo.min}
                        max={thresholdInfo.max}
                        step={thresholdKey === 'memoryMinImportance' ? 0.1 : 1}
                        value={currentValue}
                        onChange={(e) => {
                          const val = thresholdKey === 'memoryMinImportance'
                            ? parseFloat(e.target.value) || 0
                            : parseInt(e.target.value) || 0;
                          onDirectivesUpdate({
                            ruleThresholds: { ...pulseDirectives.ruleThresholds, [thresholdKey!]: val },
                            template: 'custom',
                          });
                        }}
                        className="w-16 px-1.5 py-0.5 text-xs text-center bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <span className="text-[10px] text-text-muted dark:text-dark-text-muted w-8">
                        {thresholdInfo.unit}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Allowed Actions */}
        <div>
          <h5 className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2 uppercase">
            Allowed Actions
          </h5>
          <div className="space-y-1.5">
            {actionTypes.map((action) => {
              const cooldownKey = action.id as keyof ActionCooldowns;
              const cooldownValue = pulseDirectives.actionCooldowns?.[cooldownKey];
              return (
                <div
                  key={action.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={!pulseDirectives.blockedActions.includes(action.id)}
                      onChange={() => onToggleAction(action.id)}
                      className="rounded border-border dark:border-dark-border text-primary focus:ring-primary/50"
                    />
                    <span className="text-sm text-text-primary dark:text-dark-text-primary">
                      {action.label}
                    </span>
                  </label>
                  {cooldownValue != null && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        value={cooldownValue}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(1440, parseInt(e.target.value) || 0));
                          onDirectivesUpdate({
                            actionCooldowns: { ...pulseDirectives.actionCooldowns, [cooldownKey]: val },
                            template: 'custom',
                          });
                        }}
                        className="w-16 px-1.5 py-0.5 text-xs text-center bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <span className="text-[10px] text-text-muted dark:text-dark-text-muted w-6">
                        min
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Custom Instructions */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h5 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase">
            Custom Instructions
          </h5>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            {directivesInstructions.length} / 2,000
          </span>
        </div>
        <textarea
          value={directivesInstructions}
          onChange={(e) => onDirectivesInstructionsChange(e.target.value.slice(0, 2000))}
          onBlur={() => {
            if (directivesInstructions !== pulseDirectives.customInstructions) {
              onDirectivesUpdate({
                customInstructions: directivesInstructions,
                template: 'custom',
              });
            }
          }}
          rows={3}
          placeholder="e.g. Focus on upcoming deadlines. Only notify for high-urgency items."
          className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      </div>
    </div>
  );
}
