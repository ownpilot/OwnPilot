/**
 * useWorkflowExecution — save, execute (SSE streaming), cancel, and related
 * helpers for the workflow editor.
 */

import { useCallback, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';

import { workflowsApi, triggersApi } from '../../api';
import type { Workflow, WorkflowProgressEvent } from '../../api';
import type {
  ToolNodeData,
  TriggerNodeData,
  LlmNodeData,
  ConditionNodeData,
  CodeNodeData,
  TransformerNodeData,
  ForEachNodeData,
  HttpRequestNodeData,
  DelayNodeData,
  SwitchNodeData,
} from '../../components/workflows';

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
    if (!id || !workflow) return;
    setIsSaving(true);
    try {
      // Helper: extract optional outputAlias from any node data
      const getAlias = (d: Record<string, unknown>) =>
        d.outputAlias && typeof d.outputAlias === 'string' ? { outputAlias: d.outputAlias } : {};

      const wfNodes = nodes.map((n) => {
        if (n.type === 'triggerNode') {
          const td = n.data as unknown as TriggerNodeData;
          return {
            id: n.id,
            type: 'triggerNode',
            position: n.position,
            data: {
              triggerType: td.triggerType,
              label: td.label,
              ...(td.cron ? { cron: td.cron } : {}),
              ...(td.timezone ? { timezone: td.timezone } : {}),
              ...(td.eventType ? { eventType: td.eventType } : {}),
              ...(td.filters ? { filters: td.filters } : {}),
              ...(td.condition ? { condition: td.condition } : {}),
              ...(td.threshold != null ? { threshold: td.threshold } : {}),
              ...(td.checkInterval != null ? { checkInterval: td.checkInterval } : {}),
              ...(td.webhookPath ? { webhookPath: td.webhookPath } : {}),
              ...(td.webhookSecret ? { webhookSecret: td.webhookSecret } : {}),
              ...(td.triggerId ? { triggerId: td.triggerId } : {}),
            },
          };
        }
        if (n.type === 'llmNode') {
          const ld = n.data as unknown as LlmNodeData;
          return {
            id: n.id,
            type: 'llmNode',
            position: n.position,
            data: {
              label: ld.label,
              provider: ld.provider,
              model: ld.model,
              systemPrompt: ld.systemPrompt,
              userMessage: ld.userMessage,
              temperature: ld.temperature,
              maxTokens: ld.maxTokens,
              ...(ld.apiKey ? { apiKey: ld.apiKey } : {}),
              ...(ld.baseUrl ? { baseUrl: ld.baseUrl } : {}),
              ...(ld.retryCount != null ? { retryCount: ld.retryCount } : {}),
              ...(ld.timeoutMs != null ? { timeoutMs: ld.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'conditionNode') {
          const cd = n.data as unknown as ConditionNodeData;
          return {
            id: n.id,
            type: 'conditionNode',
            position: n.position,
            data: {
              label: cd.label,
              expression: cd.expression,
              description: cd.description,
              ...(cd.retryCount != null ? { retryCount: cd.retryCount } : {}),
              ...(cd.timeoutMs != null ? { timeoutMs: cd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'codeNode') {
          const cd = n.data as unknown as CodeNodeData;
          return {
            id: n.id,
            type: 'codeNode',
            position: n.position,
            data: {
              label: cd.label,
              language: cd.language,
              code: cd.code,
              description: cd.description,
              ...(cd.retryCount != null ? { retryCount: cd.retryCount } : {}),
              ...(cd.timeoutMs != null ? { timeoutMs: cd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'transformerNode') {
          const td = n.data as unknown as TransformerNodeData;
          return {
            id: n.id,
            type: 'transformerNode',
            position: n.position,
            data: {
              label: td.label,
              expression: td.expression,
              description: td.description,
              ...(td.retryCount != null ? { retryCount: td.retryCount } : {}),
              ...(td.timeoutMs != null ? { timeoutMs: td.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'forEachNode') {
          const fd = n.data as unknown as ForEachNodeData;
          return {
            id: n.id,
            type: 'forEachNode',
            position: n.position,
            data: {
              label: fd.label,
              arrayExpression: fd.arrayExpression,
              ...(fd.itemVariable ? { itemVariable: fd.itemVariable } : {}),
              ...(fd.maxIterations != null ? { maxIterations: fd.maxIterations } : {}),
              ...(fd.onError ? { onError: fd.onError } : {}),
              ...(fd.description ? { description: fd.description } : {}),
              ...(fd.retryCount != null ? { retryCount: fd.retryCount } : {}),
              ...(fd.timeoutMs != null ? { timeoutMs: fd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'httpRequestNode') {
          const hd = n.data as unknown as HttpRequestNodeData;
          return {
            id: n.id,
            type: 'httpRequestNode',
            position: n.position,
            data: {
              label: hd.label,
              method: hd.method,
              url: hd.url,
              ...(hd.headers && Object.keys(hd.headers).length > 0 ? { headers: hd.headers } : {}),
              ...(hd.queryParams && Object.keys(hd.queryParams).length > 0
                ? { queryParams: hd.queryParams }
                : {}),
              ...(hd.body ? { body: hd.body } : {}),
              ...(hd.bodyType ? { bodyType: hd.bodyType } : {}),
              ...(hd.auth && hd.auth.type !== 'none' ? { auth: hd.auth } : {}),
              ...(hd.maxResponseSize != null ? { maxResponseSize: hd.maxResponseSize } : {}),
              ...(hd.description ? { description: hd.description } : {}),
              ...(hd.retryCount != null ? { retryCount: hd.retryCount } : {}),
              ...(hd.timeoutMs != null ? { timeoutMs: hd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'delayNode') {
          const dd = n.data as unknown as DelayNodeData;
          return {
            id: n.id,
            type: 'delayNode',
            position: n.position,
            data: {
              label: dd.label,
              duration: dd.duration,
              unit: dd.unit,
              ...(dd.description ? { description: dd.description } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'switchNode') {
          const sd = n.data as unknown as SwitchNodeData;
          return {
            id: n.id,
            type: 'switchNode',
            position: n.position,
            data: {
              label: sd.label,
              expression: sd.expression,
              cases: sd.cases,
              ...(sd.description ? { description: sd.description } : {}),
              ...(sd.retryCount != null ? { retryCount: sd.retryCount } : {}),
              ...(sd.timeoutMs != null ? { timeoutMs: sd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'errorHandlerNode') {
          const eh = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'errorHandlerNode',
            position: n.position,
            data: {
              label: eh.label ?? 'Error Handler',
              ...(eh.description ? { description: eh.description } : {}),
              ...(eh.continueOnSuccess ? { continueOnSuccess: true } : {}),
              ...getAlias(eh),
            },
          };
        }
        if (n.type === 'subWorkflowNode') {
          const sw = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'subWorkflowNode',
            position: n.position,
            data: {
              label: sw.label ?? 'Sub-Workflow',
              ...(sw.description ? { description: sw.description } : {}),
              ...(sw.subWorkflowId ? { subWorkflowId: sw.subWorkflowId } : {}),
              ...(sw.subWorkflowName ? { subWorkflowName: sw.subWorkflowName } : {}),
              ...(sw.inputMapping &&
              Object.keys(sw.inputMapping as Record<string, unknown>).length > 0
                ? { inputMapping: sw.inputMapping }
                : {}),
              ...(sw.maxDepth != null ? { maxDepth: sw.maxDepth } : {}),
              ...(sw.retryCount != null ? { retryCount: sw.retryCount } : {}),
              ...(sw.timeoutMs != null ? { timeoutMs: sw.timeoutMs } : {}),
              ...getAlias(sw),
            },
          };
        }
        if (n.type === 'approvalNode') {
          const ap = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'approvalNode',
            position: n.position,
            data: {
              label: ap.label ?? 'Approval Gate',
              ...(ap.description ? { description: ap.description } : {}),
              ...(ap.approvalMessage ? { approvalMessage: ap.approvalMessage } : {}),
              ...(ap.timeoutMinutes != null ? { timeoutMinutes: ap.timeoutMinutes } : {}),
              ...getAlias(ap),
            },
          };
        }
        if (n.type === 'stickyNoteNode') {
          const sn = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'stickyNoteNode',
            position: n.position,
            data: {
              label: sn.label ?? 'Note',
              ...(sn.text ? { text: sn.text } : {}),
              ...(sn.color ? { color: sn.color } : {}),
            },
          };
        }
        if (n.type === 'notificationNode') {
          const nn = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'notificationNode',
            position: n.position,
            data: {
              label: nn.label ?? 'Notification',
              ...(nn.message ? { message: nn.message } : {}),
              ...(nn.severity ? { severity: nn.severity } : {}),
              ...(nn.description ? { description: nn.description } : {}),
              ...(nn.retryCount != null ? { retryCount: nn.retryCount } : {}),
              ...(nn.timeoutMs != null ? { timeoutMs: nn.timeoutMs } : {}),
              ...getAlias(nn),
            },
          };
        }
        if (n.type === 'parallelNode') {
          const pn = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'parallelNode',
            position: n.position,
            data: {
              label: pn.label ?? 'Parallel',
              ...(pn.branchCount != null ? { branchCount: pn.branchCount } : {}),
              ...(pn.branchLabels ? { branchLabels: pn.branchLabels } : {}),
              ...(pn.description ? { description: pn.description } : {}),
              ...getAlias(pn),
            },
          };
        }
        if (n.type === 'mergeNode') {
          const mn = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'mergeNode',
            position: n.position,
            data: {
              label: mn.label ?? 'Merge',
              ...(mn.mode ? { mode: mn.mode } : {}),
              ...(mn.description ? { description: mn.description } : {}),
              ...getAlias(mn),
            },
          };
        }
        const toolData = n.data as ToolNodeData;
        return {
          id: n.id,
          type: n.type || 'toolNode',
          position: n.position,
          data: {
            toolName: toolData.toolName,
            toolArgs: toolData.toolArgs,
            label: toolData.label,
            description: toolData.description,
            ...(toolData.retryCount != null ? { retryCount: toolData.retryCount } : {}),
            ...(toolData.timeoutMs != null ? { timeoutMs: toolData.timeoutMs } : {}),
            ...getAlias(n.data as unknown as Record<string, unknown>),
          },
        };
      });

      const wfEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }));

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
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
        await handleSave();
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
        const response = await workflowsApi.execute(id, { dryRun });
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
