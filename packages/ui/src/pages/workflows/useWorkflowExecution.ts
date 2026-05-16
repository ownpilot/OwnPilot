/**
 * useWorkflowExecution — save, execute (SSE streaming), cancel, and related
 * helpers for the workflow editor.
 */

import { useCallback, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';

import { workflowsApi, triggersApi } from '../../api';
import type { Workflow, WorkflowProgressEvent } from '../../api';
import type { TriggerNodeData } from '../../components/workflows';
import { serializeWorkflowCanvas } from './workflowPersistence';

export interface WorkflowExecutionParams {
  id: string | undefined;
  workflow: Workflow | null;
  nodes: Node[];
  edges: Edge[];
  workflowName: string;
  variables: Record<string, unknown>;
  inputSchema: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'json';
    required: boolean;
    defaultValue?: string;
    description?: string;
  }>;
  isExecuting: boolean;
  hasUnsavedChanges: boolean;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setIsSaving: (v: boolean) => void;
  setIsExecuting: (v: boolean) => void;
  setIsDryRun: (v: boolean) => void;
  setHasUnsavedChanges: (v: boolean) => void;
  abortRef: React.MutableRefObject<AbortController | null>;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  syncTrigger: (
    workflowId: string,
    wfName: string,
    td: TriggerNodeData,
    nodeId: string
  ) => Promise<void>;
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export function useWorkflowExecution(params: WorkflowExecutionParams) {
  const {
    id,
    workflow,
    nodes,
    edges,
    workflowName,
    variables,
    inputSchema,
    isExecuting,
    hasUnsavedChanges,
    setNodes,
    setEdges,
    setIsSaving,
    setIsExecuting,
    setIsDryRun,
    setHasUnsavedChanges,
    abortRef,
    updateNodeData,
    syncTrigger,
    toast,
  } = params;

  // ========================================================================
  // Execution progress tracking
  // ========================================================================

  const [executionProgress, setExecutionProgress] = useState<{
    total: number;
    completed: number;
    running: string | null;
    failed: number;
    retries: number;
  } | null>(null);

  // ========================================================================
  // Save
  // ========================================================================

  const handleSave = useCallback(async () => {
    if (!id || !workflow) return false;
    setIsSaving(true);
    try {
      const { nodes: wfNodes, edges: wfEdges } = serializeWorkflowCanvas(nodes, edges);

      await workflowsApi.update(id, {
        name: workflowName,
        nodes: wfNodes,
        edges: wfEdges,
        variables,
        inputSchema,
      });

      // Sync trigger node with trigger system
      const triggerNode = nodes.find((n) => n.type === 'triggerNode');
      if (triggerNode) {
        const td = triggerNode.data as unknown as TriggerNodeData;
        if (td.triggerType !== 'manual') {
          await syncTrigger(id, workflowName, td, triggerNode.id);
        } else if (td.triggerId) {
          // Manual mode -- delete linked trigger
          try {
            await triggersApi.delete(td.triggerId);
          } catch {
            /* may not exist */
          }
          updateNodeData(triggerNode.id, { triggerId: undefined });
        }
      } else {
        // Trigger node removed -- clean up linked trigger if it existed
        const oldTrigger = workflow.nodes.find((n) => n.type === 'triggerNode');
        const oldTriggerId = (oldTrigger?.data as unknown as Record<string, unknown>)?.triggerId as
          | string
          | undefined;
        if (oldTriggerId) {
          try {
            await triggersApi.delete(oldTriggerId);
          } catch {
            /* ignore */
          }
        }
      }

      setHasUnsavedChanges(false);
      toast.success('Workflow saved');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    id,
    workflow,
    nodes,
    edges,
    workflowName,
    variables,
    inputSchema,
    toast,
    updateNodeData,
    syncTrigger,
    setIsSaving,
    setHasUnsavedChanges,
  ]);

  // ========================================================================
  // SSE progress event handler
  // ========================================================================

  /** Resolve a node label from the current nodes array */
  const getNodeLabel = useCallback(
    (nodeId: string | undefined): string | null => {
      if (!nodeId) return null;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return nodeId;
      const label = (node.data as Record<string, unknown>).label;
      return typeof label === 'string' && label ? label : nodeId;
    },
    [nodes]
  );

  const handleProgressEvent = useCallback(
    (event: WorkflowProgressEvent) => {
      switch (event.type) {
        case 'started':
          setExecutionProgress({
            total: nodes.length,
            completed: 0,
            running: null,
            failed: 0,
            retries: 0,
          });
          break;

        case 'node_start':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId ? { ...n, data: { ...n.data, executionStatus: 'running' } } : n
            )
          );
          setExecutionProgress((prev) =>
            prev ? { ...prev, running: getNodeLabel(event.nodeId) } : null
          );
          break;

        case 'node_complete':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      executionStatus: event.status ?? 'success',
                      executionDuration: event.durationMs,
                      executionOutput: event.output,
                      resolvedArgs: event.resolvedArgs,
                      branchTaken: event.branchTaken,
                    },
                  }
                : n
            )
          );
          setExecutionProgress((prev) =>
            prev ? { ...prev, completed: prev.completed + 1, running: null } : null
          );
          break;

        case 'node_error':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      executionStatus: 'error',
                      executionError: event.error,
                    },
                  }
                : n
            )
          );
          setExecutionProgress((prev) =>
            prev ? { ...prev, failed: prev.failed + 1, running: null } : null
          );
          break;

        case 'node_retry':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      executionStatus: 'running',
                      retryAttempt: event.retryAttempt,
                    },
                  }
                : n
            )
          );
          setExecutionProgress((prev) => (prev ? { ...prev, retries: prev.retries + 1 } : null));
          break;

        case 'foreach_iteration_start':
        case 'foreach_iteration_complete':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      currentIteration: event.iterationIndex,
                      totalIterations: event.iterationTotal,
                    },
                  }
                : n
            )
          );
          break;

        case 'done':
          setExecutionProgress((prev) => (prev ? { ...prev, running: null } : null));
          toast.success(
            event.logStatus === 'completed'
              ? `Workflow completed in ${event.durationMs ? `${(event.durationMs / 1000).toFixed(1)}s` : 'N/A'}`
              : `Workflow ${event.logStatus ?? 'finished'}`
          );
          break;

        case 'error':
          toast.error(event.error ?? 'Execution error');
          break;
      }
    },
    [setNodes, toast, nodes, getNodeLabel]
  );

  // ========================================================================
  // Execute -- SSE stream with real-time node coloring
  // ========================================================================

  const handleExecute = useCallback(
    async (dryRun = false) => {
      if (!id || isExecuting) return;

      if (hasUnsavedChanges) {
        const saved = await handleSave();
        if (!saved) return;
      }

      setIsExecuting(true);
      setIsDryRun(dryRun);

      // Reset all node statuses
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            executionStatus: 'pending',
            executionError: undefined,
            executionDuration: undefined,
            executionOutput: undefined,
            resolvedArgs: undefined,
            branchTaken: undefined,
            currentIteration: undefined,
            totalIterations: undefined,
          },
        }))
      );

      // Animate edges during execution
      setEdges((eds) => eds.map((e) => ({ ...e, animated: true })));

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const response = await workflowsApi.execute(id, { dryRun, signal: abort.signal });
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No stream available');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            let event: WorkflowProgressEvent;
            try {
              event = JSON.parse(dataStr);
            } catch {
              continue;
            }

            handleProgressEvent(event);
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          toast.error(err instanceof Error ? err.message : 'Execution failed');
        }
      } finally {
        setIsExecuting(false);
        setIsDryRun(false);
        setExecutionProgress(null);
        abortRef.current = null;
        setEdges((eds) => eds.map((e) => ({ ...e, animated: false })));
      }
    },
    [
      id,
      isExecuting,
      hasUnsavedChanges,
      handleSave,
      toast,
      setNodes,
      setEdges,
      setIsExecuting,
      setIsDryRun,
      abortRef,
      handleProgressEvent,
    ]
  );

  const handleCancel = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    try {
      await workflowsApi.cancel(id);
      toast.success('Execution cancelled');
    } catch {
      // May already be finished
    }
  }, [id, toast, abortRef]);

  return {
    handleSave,
    handleExecute,
    handleCancel,
    executionProgress,
  };
}
