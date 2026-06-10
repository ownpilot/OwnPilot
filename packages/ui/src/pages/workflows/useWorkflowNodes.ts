/**
 * useWorkflowNodes — all addXxxNode functions, hasTriggerNode, syncTrigger,
 * and handleAddNode for the workflow editor.
 */

import { useCallback, useMemo } from 'react';
import type { Node } from '@xyflow/react';

import { apiClient, triggersApi } from '../../api';
import { formatToolName } from '../../utils/formatters';
import type { TriggerNodeData } from '../../components/workflows';

interface WorkflowNodesParams {
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setSelectedNodeId: (id: string | null) => void;
  setHasUnsavedChanges: (v: boolean) => void;
  nodeIdCounter: React.MutableRefObject<number>;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  toast: { warning: (msg: string) => void; success: (msg: string) => void };
}

/** Calculate auto-position for new nodes based on existing layout */
function calcNewNodePosition(nodes: Node[]): { x: number; y: number } {
  let y = 200;
  let x = 400;
  if (nodes.length > 0) {
    const maxY = Math.max(...nodes.map((n) => n.position.y));
    y = maxY + 120;
    const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
    x = Math.round(avgX / 16) * 16;
  }
  return { x, y };
}

export function useWorkflowNodes(params: WorkflowNodesParams) {
  const {
    nodes,
    setNodes,
    setSelectedNodeId,
    setHasUnsavedChanges,
    nodeIdCounter,
    updateNodeData,
    toast,
  } = params;

  const hasTriggerNode = useMemo(() => nodes.some((n) => n.type === 'triggerNode'), [nodes]);

  const addTriggerNode = useCallback(() => {
    if (hasTriggerNode) {
      toast.warning('Only one trigger node per workflow');
      return;
    }
    nodeIdCounter.current += 1;
    const newId = `node_${nodeIdCounter.current}`;
    const newNode: Node = {
      id: newId,
      type: 'triggerNode',
      position: { x: 300, y: 50 },
      data: { triggerType: 'manual', label: 'Trigger' },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newId);
    setHasUnsavedChanges(true);
  }, [hasTriggerNode, setNodes, toast, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a tool node from the palette "+" button (auto-positioned) */
  const addToolNode = useCallback(
    (toolName: string, toolDescription?: string) => {
      nodeIdCounter.current += 1;
      const newNodeId = `node_${nodeIdCounter.current}`;
      const { x, y } = calcNewNodePosition(nodes);

      const newNode: Node = {
        id: newNodeId,
        type: 'toolNode',
        position: { x, y },
        data: {
          toolName,
          toolArgs: {},
          label: formatToolName(toolName),
          description: toolDescription,
        },
      };

      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(newNodeId);
      setHasUnsavedChanges(true);
    },
    [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]
  );

  /** Add an LLM node from the toolbar button (auto-positioned) */
  const addLlmNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'llmNode',
      position: { x, y },
      data: {
        label: 'LLM',
        provider: '',
        model: '',
        userMessage: '',
        temperature: 0.7,
        maxTokens: 4096,
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Condition (if/else) node from the toolbar button */
  const addConditionNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'conditionNode',
      position: { x, y },
      data: { label: 'Condition', expression: '' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Code execution node from the toolbar button */
  const addCodeNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'codeNode',
      position: { x, y },
      data: { label: 'Code', language: 'javascript', code: '' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Transformer node from the toolbar button */
  const addTransformerNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'transformerNode',
      position: { x, y },
      data: { label: 'Transform', expression: '' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a ForEach (loop) node from the toolbar button */
  const addForEachNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'forEachNode',
      position: { x, y },
      data: { label: 'ForEach', arrayExpression: '', maxIterations: 100, onError: 'stop' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add an HTTP Request node from the toolbar button */
  const addHttpRequestNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'httpRequestNode',
      position: { x, y },
      data: { label: 'HTTP Request', method: 'GET', url: '' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Delay node from the toolbar button */
  const addDelayNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'delayNode',
      position: { x, y },
      data: { label: 'Delay', duration: '5', unit: 'seconds' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Notification node */
  const addNotificationNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'notificationNode',
        position: { x, y },
        data: { label: 'Notification', message: '', severity: 'info' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Parallel node */
  const addParallelNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'parallelNode',
        position: { x, y },
        data: { label: 'Parallel', branchCount: 2, branchLabels: ['Branch 0', 'Branch 1'] },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Merge node */
  const addMergeNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'mergeNode',
        position: { x, y },
        data: { label: 'Merge', mode: 'waitAll' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Data Store node */
  const addDataStoreNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'dataStoreNode',
        position: { x, y },
        data: { label: 'Data Store', operation: 'get', key: '', namespace: '' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Schema Validator node */
  const addSchemaValidatorNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'schemaValidatorNode',
        position: { x, y },
        data: { label: 'Schema Validator', schema: '{}', strict: false, requiredFields: 0 },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Filter node */
  const addFilterNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'filterNode',
        position: { x, y },
        data: { label: 'Filter', arrayExpression: '', condition: '' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Map node */
  const addMapNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'mapNode',
        position: { x, y },
        data: { label: 'Map', arrayExpression: '', expression: '' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add an Aggregate node */
  const addAggregateNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'aggregateNode',
        position: { x, y },
        data: { label: 'Aggregate', arrayExpression: '', operation: 'count', field: '' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Webhook Response node */
  const addWebhookResponseNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'webhookResponseNode',
        position: { x, y },
        data: { label: 'Webhook Response', statusCode: 200, contentType: 'application/json' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add an Error Handler node (max 1 per workflow, mirrors backend rule) */
  const addErrorHandlerNode = useCallback(() => {
    if (nodes.some((n) => n.type === 'errorHandlerNode')) {
      toast.warning('Only one error handler node per workflow');
      return;
    }
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'errorHandlerNode',
        position: { x, y },
        data: { label: 'Error Handler' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, toast, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Sub-Workflow node */
  const addSubWorkflowNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'subWorkflowNode',
        position: { x, y },
        data: { label: 'Sub-Workflow' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add an Approval Gate node */
  const addApprovalNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'approvalNode',
        position: { x, y },
        data: { label: 'Approval Gate', approvalMessage: '' },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Claw agent node */
  const addClawNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    setNodes((nds) => [
      ...nds,
      {
        id: newNodeId,
        type: 'clawNode',
        position: { x, y },
        data: {
          label: 'Claw Agent',
          name: '',
          mission: '',
          mode: 'single-shot',
          sandbox: 'auto',
          waitForCompletion: true,
        },
      },
    ]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Sticky Note node from the toolbar button */
  const addStickyNoteNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'stickyNoteNode',
      position: { x, y },
      data: { label: 'Note', text: '', color: 'yellow' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  /** Add a Switch node from the toolbar button */
  const addSwitchNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    const { x, y } = calcNewNodePosition(nodes);

    const newNode: Node = {
      id: newNodeId,
      type: 'switchNode',
      position: { x, y },
      data: {
        label: 'Switch',
        expression: '',
        cases: [{ label: 'case_1', value: '' }],
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]);

  const syncTrigger = useCallback(
    async (workflowId: string, wfName: string, td: TriggerNodeData, nodeId: string) => {
      const config: Record<string, unknown> = {};
      if (td.triggerType === 'schedule') {
        config.cron = td.cron ?? '0 8 * * *';
        if (td.timezone) config.timezone = td.timezone;
      } else if (td.triggerType === 'event') {
        config.eventType = td.eventType ?? '';
      } else if (td.triggerType === 'condition') {
        config.condition = td.condition ?? '';
        if (td.threshold) config.threshold = td.threshold;
        if (td.checkInterval) config.checkInterval = td.checkInterval;
      } else if (td.triggerType === 'webhook') {
        if (td.webhookPath) config.webhookPath = td.webhookPath;
      }

      const body = {
        name: `Workflow: ${wfName}`,
        type: td.triggerType,
        config,
        action: { type: 'workflow' as const, payload: { workflowId } },
        enabled: true,
      };

      try {
        if (td.triggerId) {
          await triggersApi.update(td.triggerId, body);
        } else {
          const created = await apiClient.post<{ id: string }>('/triggers', body);
          updateNodeData(nodeId, { triggerId: created.id });
        }
      } catch {
        // Non-critical -- trigger sync failure shouldn't block save
      }
    },
    [updateNodeData]
  );

  const handleAddNode = useCallback(
    (nodeType: string) => {
      switch (nodeType) {
        case 'triggerNode':
          addTriggerNode();
          break;
        case 'llmNode':
          addLlmNode();
          break;
        case 'conditionNode':
          addConditionNode();
          break;
        case 'codeNode':
          addCodeNode();
          break;
        case 'transformerNode':
          addTransformerNode();
          break;
        case 'forEachNode':
          addForEachNode();
          break;
        case 'httpRequestNode':
          addHttpRequestNode();
          break;
        case 'delayNode':
          addDelayNode();
          break;
        case 'switchNode':
          addSwitchNode();
          break;
        case 'stickyNoteNode':
          addStickyNoteNode();
          break;
        case 'notificationNode':
          addNotificationNode();
          break;
        case 'parallelNode':
          addParallelNode();
          break;
        case 'mergeNode':
          addMergeNode();
          break;
        case 'dataStoreNode':
          addDataStoreNode();
          break;
        case 'schemaValidatorNode':
          addSchemaValidatorNode();
          break;
        case 'filterNode':
          addFilterNode();
          break;
        case 'mapNode':
          addMapNode();
          break;
        case 'aggregateNode':
          addAggregateNode();
          break;
        case 'webhookResponseNode':
          addWebhookResponseNode();
          break;
        case 'errorHandlerNode':
          addErrorHandlerNode();
          break;
        case 'subWorkflowNode':
          addSubWorkflowNode();
          break;
        case 'approvalNode':
          addApprovalNode();
          break;
        case 'clawNode':
          addClawNode();
          break;
      }
    },
    [
      addTriggerNode,
      addLlmNode,
      addConditionNode,
      addCodeNode,
      addTransformerNode,
      addForEachNode,
      addHttpRequestNode,
      addDelayNode,
      addSwitchNode,
      addStickyNoteNode,
      addNotificationNode,
      addParallelNode,
      addMergeNode,
      addDataStoreNode,
      addSchemaValidatorNode,
      addFilterNode,
      addMapNode,
      addAggregateNode,
      addWebhookResponseNode,
      addErrorHandlerNode,
      addSubWorkflowNode,
      addApprovalNode,
      addClawNode,
    ]
  );

  return {
    hasTriggerNode,
    addToolNode,
    syncTrigger,
    handleAddNode,
  };
}
