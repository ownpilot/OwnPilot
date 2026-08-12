/**
 * useClawActions — every operation performed on a claw, plus the selection and
 * bulk-run state those operations own.
 *
 * Split out of ClawsPage.tsx (1203 LOC), which was a single component. The
 * selection set, per-item "applying fix" set and bulk-op progress exist only to
 * serve these handlers, so they live here rather than being threaded back in as
 * arguments.
 *
 * `openClawDetail` deliberately stays on the page: it drives page navigation
 * state, not a claw operation.
 */

import { useState } from 'react';
import { clawsApi } from '../../api/endpoints/claws';
import type { ClawConfig, ClawRecommendation } from '../../api/endpoints/claws';
import type { useDialog } from '../../components/ConfirmDialog';

type ConfirmFn = ReturnType<typeof useDialog>['confirm'];

type BulkOp = 'stop' | 'delete' | 'start' | 'pause';

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  warning: (msg: string) => void;
}

interface UseClawActionsOptions {
  claws: ClawConfig[];
  recommendations: ClawRecommendation[];
  /** Re-fetch the claw list after a mutation. */
  refresh: () => void;
  toast: ToastApi;
  confirm: ConfirmFn;
  /** Currently open detail panel — cleared when its claw is deleted. */
  selectedClaw: ClawConfig | null;
  setSelectedClaw: (claw: ClawConfig | null) => void;
}

export function useClawActions({
  claws,
  recommendations,
  refresh: fetchClaws,
  toast,
  confirm,
  selectedClaw,
  setSelectedClaw,
}: UseClawActionsOptions) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applyingFixIds, setApplyingFixIds] = useState<Set<string>>(new Set());
  const [isApplyingBatchFixes, setIsApplyingBatchFixes] = useState(false);
  const [bulkOp, setBulkOp] = useState<BulkOp | null>(null);
  const [bulkResults, setBulkResults] = useState<Array<{ id: string; ok: boolean; name: string }>>(
    []
  );

  const startClaw = async (id: string) => {
    try {
      await clawsApi.start(id);
      toast.success('Claw started');
      fetchClaws();
    } catch {
      toast.error('Failed to start claw');
    }
  };

  const pauseClaw = async (id: string) => {
    try {
      await clawsApi.pause(id);
      toast.success('Claw paused');
      fetchClaws();
    } catch {
      toast.error('Failed to pause claw');
    }
  };

  const resumeClaw = async (id: string) => {
    try {
      await clawsApi.resume(id);
      toast.success('Claw resumed');
      fetchClaws();
    } catch {
      toast.error('Failed to resume claw');
    }
  };

  const stopClaw = async (id: string) => {
    try {
      await clawsApi.stop(id);
      toast.success('Claw stopped');
      fetchClaws();
    } catch {
      toast.error('Failed to stop claw');
    }
  };

  const deleteClaw = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete Claw',
      message: `Delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await clawsApi.delete(id);
      toast.success('Claw deleted');
      if (selectedClaw?.id === id) setSelectedClaw(null);
      fetchClaws();
    } catch {
      toast.error('Failed to delete claw');
    }
  };

  const approveEscalation = async (id: string) => {
    try {
      await clawsApi.approveEscalation(id);
      toast.success('Escalation approved');
      fetchClaws();
    } catch {
      toast.error('Failed to approve escalation');
    }
  };

  const denyEscalation = async (id: string) => {
    try {
      await clawsApi.denyEscalation(id);
      toast.success('Escalation denied — claw resumed without the request');
      fetchClaws();
    } catch {
      toast.error('Failed to deny escalation');
    }
  };

  const cloneClaw = async (source: ClawConfig) => {
    try {
      await clawsApi.create({
        name: `${source.name} (copy)`,
        mission: source.mission,
        mode: source.mode,
        sandbox: source.sandbox,
        provider: source.provider,
        model: source.model,
        coding_agent_provider: source.codingAgentProvider,
        skills: source.skills,
        allowed_tools: source.allowedTools.length > 0 ? source.allowedTools : undefined,
        interval_ms: source.intervalMs,
        event_filters: source.eventFilters,
        stop_condition: source.stopCondition,
        preset: source.preset,
        mission_contract: source.missionContract,
        autonomy_policy: source.autonomyPolicy,
      });
      toast.success(`Cloned "${source.name}"`);
      fetchClaws();
    } catch {
      toast.error('Failed to clone claw');
    }
  };

  const applySafeFixes = async (id: string) => {
    setApplyingFixIds((prev) => new Set(prev).add(id));
    try {
      const result = await clawsApi.applyRecommendations(id);
      if (result.applied.length > 0) {
        toast.success(
          `Applied ${result.applied.length} safe fix${result.applied.length === 1 ? '' : 'es'}`
        );
      } else {
        toast.success('No safe fixes needed');
      }
      if (selectedClaw?.id === id) setSelectedClaw(result.claw);
      fetchClaws();
    } catch {
      toast.error('Failed to apply safe fixes');
    } finally {
      setApplyingFixIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const applyTopSafeFixes = async () => {
    setIsApplyingBatchFixes(true);
    try {
      const ids = recommendations.slice(0, 4).map((item) => item.clawId);
      const result = await clawsApi.applyRecommendationBatch(ids);
      toast.success(`Updated ${result.updated} claw${result.updated === 1 ? '' : 's'}`);
      if (selectedClaw && ids.includes(selectedClaw.id)) setSelectedClaw(null);
      fetchClaws();
    } catch {
      toast.error('Failed to apply safe fixes');
    } finally {
      setIsApplyingBatchFixes(false);
    }
  };

  // Bulk actions
  const bulkStop = async () => {
    setBulkOp('stop');
    setBulkResults([]);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map((id) => clawsApi.stop(id)));
    const named = ids.map((id, i) => ({
      id,
      ok: results[i]?.status === 'fulfilled',
      name: claws.find((c) => c.id === id)?.name ?? id,
    }));
    setBulkResults(named);
    setBulkOp(null);
    const ok = named.filter((r) => r.ok).length;
    toast.success(`Stopped ${ok}/${ids.length} claws`);
    setSelectedIds(new Set());
    fetchClaws();
  };

  const bulkDelete = async () => {
    const ok = await confirm({
      title: 'Delete Selected',
      message: `Delete ${selectedIds.size} claws?`,
      confirmText: 'Delete All',
      variant: 'danger',
    });
    if (!ok) return;
    setBulkOp('delete');
    setBulkResults([]);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map((id) => clawsApi.delete(id)));
    const named = ids.map((id, i) => ({
      id,
      ok: results[i]?.status === 'fulfilled',
      name: claws.find((c) => c.id === id)?.name ?? id,
    }));
    setBulkResults(named);
    setBulkOp(null);
    const success = named.filter((r) => r.ok).length;
    toast.success(`Deleted ${success}/${ids.length} claws`);
    setSelectedIds(new Set());
    setSelectedClaw(null);
    fetchClaws();
  };

  const bulkStart = async () => {
    setBulkOp('start');
    setBulkResults([]);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map((id) => clawsApi.start(id)));
    const named = ids.map((id, i) => ({
      id,
      ok: results[i]?.status === 'fulfilled',
      name: claws.find((c) => c.id === id)?.name ?? id,
    }));
    setBulkResults(named);
    setBulkOp(null);
    const ok = named.filter((r) => r.ok).length;
    toast.success(`Started ${ok}/${ids.length} claws`);
    setSelectedIds(new Set());
    fetchClaws();
  };

  const bulkPause = async () => {
    setBulkOp('pause');
    setBulkResults([]);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map((id) => clawsApi.pause(id)));
    const named = ids.map((id, i) => ({
      id,
      ok: results[i]?.status === 'fulfilled',
      name: claws.find((c) => c.id === id)?.name ?? id,
    }));
    setBulkResults(named);
    setBulkOp(null);
    const ok = named.filter((r) => r.ok).length;
    toast.success(`Paused ${ok}/${ids.length} claws`);
    setSelectedIds(new Set());
    fetchClaws();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  };

  return {
    // state owned by the actions
    selectedIds,
    setSelectedIds,
    applyingFixIds,
    isApplyingBatchFixes,
    bulkOp,
    bulkResults,
    // operations
    startClaw,
    pauseClaw,
    resumeClaw,
    stopClaw,
    deleteClaw,
    approveEscalation,
    denyEscalation,
    cloneClaw,
    applySafeFixes,
    applyTopSafeFixes,
    bulkStop,
    bulkDelete,
    bulkStart,
    bulkPause,
    toggleSelect,
  };
}
