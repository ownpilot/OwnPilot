import type {
  ClawAutonomyPolicy,
  ClawConfig,
  ClawMissionContract,
  UpdateClawInput,
} from '@ownpilot/core/services/claw';

export interface ClawPresetRecommendationDefaults {
  id: string;
  successCriteria?: string[];
  deliverables?: string[];
  constraints?: string[];
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function findPreset(
  config: ClawConfig,
  presets: readonly ClawPresetRecommendationDefaults[]
): ClawPresetRecommendationDefaults | undefined {
  return presets.find((preset) => preset.id === config.preset);
}

export function buildSafeFixPatch(
  config: ClawConfig,
  presets: readonly ClawPresetRecommendationDefaults[] = []
): {
  patch: UpdateClawInput;
  applied: string[];
  skipped: string[];
} {
  const patch: UpdateClawInput = {};
  const applied: string[] = [];
  const skipped: string[] = [];
  const preset = findPreset(config, presets);
  const currentContract = config.missionContract;

  const missionContract: ClawMissionContract = {
    successCriteria: currentContract?.successCriteria?.length
      ? currentContract.successCriteria
      : (preset?.successCriteria ?? ['Mission outcome is complete, specific, and verifiable']),
    deliverables: currentContract?.deliverables?.length
      ? currentContract.deliverables
      : (preset?.deliverables ?? ['Final artifact or report with decisions and evidence']),
    constraints: currentContract?.constraints?.length
      ? currentContract.constraints
      : (preset?.constraints ?? ['Do not perform destructive actions without approval']),
    escalationRules: currentContract?.escalationRules?.length
      ? currentContract.escalationRules
      : [
          'Escalate when permissions, budget, missing context, or destructive actions block progress',
        ],
    evidenceRequired: true,
    minConfidence: Math.max(currentContract?.minConfidence ?? 0.8, 0.8),
  };

  const contractChanged =
    !currentContract ||
    !arraysEqual(currentContract.successCriteria, missionContract.successCriteria) ||
    !arraysEqual(currentContract.deliverables, missionContract.deliverables) ||
    !arraysEqual(currentContract.constraints, missionContract.constraints) ||
    !arraysEqual(currentContract.escalationRules, missionContract.escalationRules) ||
    currentContract.evidenceRequired !== missionContract.evidenceRequired ||
    currentContract.minConfidence !== missionContract.minConfidence;

  if (contractChanged) {
    patch.missionContract = missionContract;
    applied.push('mission_contract');
  }

  if (!config.stopCondition) {
    patch.stopCondition = config.mode === 'single-shot' ? 'on_report' : 'idle:3';
    applied.push('stop_condition');
  }

  const currentPolicy = config.autonomyPolicy;
  const autonomyPolicy: ClawAutonomyPolicy = {
    allowSelfModify: false,
    allowSubclaws: currentPolicy?.allowSubclaws ?? true,
    requireEvidence: true,
    destructiveActionPolicy:
      currentPolicy?.destructiveActionPolicy === 'allow'
        ? 'ask'
        : (currentPolicy?.destructiveActionPolicy ?? 'ask'),
    filesystemScopes: currentPolicy?.filesystemScopes ?? [],
    maxCostUsdBeforePause: currentPolicy?.maxCostUsdBeforePause,
  };

  const policyChanged =
    !currentPolicy ||
    currentPolicy.allowSelfModify !== autonomyPolicy.allowSelfModify ||
    currentPolicy.allowSubclaws !== autonomyPolicy.allowSubclaws ||
    currentPolicy.requireEvidence !== autonomyPolicy.requireEvidence ||
    currentPolicy.destructiveActionPolicy !== autonomyPolicy.destructiveActionPolicy ||
    !arraysEqual(currentPolicy.filesystemScopes, autonomyPolicy.filesystemScopes) ||
    currentPolicy.maxCostUsdBeforePause !== autonomyPolicy.maxCostUsdBeforePause;

  if (policyChanged) {
    patch.autonomyPolicy = autonomyPolicy;
    applied.push('autonomy_policy');
  }

  if (config.mode === 'event' && (config.eventFilters?.length ?? 0) === 0) {
    skipped.push('event_filters requires a project-specific event source');
  }

  return { patch, applied, skipped };
}
