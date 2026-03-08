/**
 * Workflow Editor Page
 *
 * Three-panel layout:
 * +------------------+------------------------+-----------------+
 * | ToolPalette      | ReactFlow Canvas       | NodeConfigPanel |
 * | (240px, left)    | (flex-1, center)       | (320px, right)  |
 * +------------------+------------------------+-----------------+
 *
 * Top bar: Back, workflow name (editable), Save, Execute, status.
 * Execution: SSE streaming with real-time node coloring.
 */

import { ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  ToolPalette,
  NodeConfigPanel,
  WorkflowSourceModal,
  NodeSearchPalette,
  WorkflowCopilotPanel,
  VariablesPanel,
  WorkflowVersionsPanel,
  InputParametersPanel,
  TemplateGallery,
  convertDefinitionToReactFlow,
  type WorkflowDefinition,
} from '../components/workflows';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useWorkflowEditor } from './workflows/useWorkflowEditor';
import { WorkflowEditorToolbar } from './workflows/WorkflowEditorToolbar';
import { WorkflowCanvas } from './workflows/WorkflowCanvas';
import { getEdgeLabelProps } from './workflows/shared';

// ============================================================================
// Main Component (wrapped in ReactFlowProvider for hook access)
// ============================================================================

export function WorkflowEditorPage() {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  );
}

function WorkflowEditorInner() {
  const editor = useWorkflowEditor();

  // ========================================================================
  // Render
  // ========================================================================

  if (editor.isLoading) {
    return <LoadingSpinner message="Loading workflow..." />;
  }

  if (!editor.workflow) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <WorkflowEditorToolbar
        workflowName={editor.workflowName}
        setWorkflowName={editor.setWorkflowName}
        hasUnsavedChanges={editor.hasUnsavedChanges}
        setHasUnsavedChanges={editor.setHasUnsavedChanges}
        isSaving={editor.isSaving}
        isExecuting={editor.isExecuting}
        isDryRun={editor.isDryRun}
        nodes={editor.nodes}
        variables={editor.variables}
        inputSchema={editor.inputSchema}
        showVariables={editor.showVariables}
        setShowVariables={editor.setShowVariables}
        showCopilot={editor.showCopilot}
        setShowCopilot={editor.setShowCopilot}
        showVersions={editor.showVersions}
        setShowVersions={editor.setShowVersions}
        showInputParams={editor.showInputParams}
        setShowInputParams={editor.setShowInputParams}
        setShowTemplates={editor.setShowTemplates}
        setShowSource={editor.setShowSource}
        setSelectedNodeId={editor.setSelectedNodeId}
        navigate={editor.navigate}
        handleSave={editor.handleSave}
        handleArrange={editor.handleArrange}
        handleExecute={editor.handleExecute}
        handleCancel={editor.handleCancel}
      />

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        <ToolPalette
          className="w-60 shrink-0"
          onAddTool={editor.addToolNode}
          onAddNode={editor.handleAddNode}
          hasTriggerNode={editor.hasTriggerNode}
        />

        <WorkflowCanvas
          nodes={editor.nodes}
          edges={editor.edges}
          isExecuting={editor.isExecuting}
          onNodesChange={editor.onNodesChangeWrapped}
          onEdgesChange={editor.onEdgesChangeWrapped}
          onConnect={editor.onConnect}
          isValidConnection={editor.isValidConnection}
          onNodeClick={editor.onNodeClick}
          onPaneClick={editor.onPaneClick}
          onDragOver={editor.onDragOver}
          onDrop={editor.onDrop}
        />

        {editor.selectedNode ? (
          <NodeConfigPanel
            node={editor.selectedNode}
            upstreamNodes={editor.upstreamNodes}
            onUpdate={editor.updateNodeData}
            onDelete={editor.deleteNode}
            onClose={() => editor.setSelectedNodeId(null)}
            className="w-80 shrink-0"
          />
        ) : editor.showVariables ? (
          <VariablesPanel
            variables={editor.variables}
            onChange={editor.handleVariablesChange}
            onClose={() => editor.setShowVariables(false)}
            className="w-80 shrink-0"
          />
        ) : editor.showInputParams ? (
          <InputParametersPanel
            parameters={editor.inputSchema}
            onChange={(params) => {
              editor.setInputSchema(params);
              editor.setHasUnsavedChanges(true);
            }}
            onClose={() => editor.setShowInputParams(false)}
          />
        ) : editor.showVersions && editor.id ? (
          <WorkflowVersionsPanel
            workflowId={editor.id}
            onRestore={(data) => {
              editor.setNodes(data.nodes as Node[]);
              editor.setEdges(data.edges as Edge[]);
              editor.setVariables(data.variables);
              editor.setHasUnsavedChanges(false);
              editor.toast.success('Version restored');
            }}
            onClose={() => editor.setShowVersions(false)}
            className="w-80 shrink-0"
          />
        ) : editor.showCopilot ? (
          <WorkflowCopilotPanel
            workflowName={editor.workflowName}
            nodes={editor.nodes}
            edges={editor.edges}
            availableToolNames={editor.toolNames}
            onApplyWorkflow={editor.handleApplyWorkflow}
            onClose={() => editor.setShowCopilot(false)}
          />
        ) : null}
      </div>

      {editor.showNodeSearch && (
        <NodeSearchPalette
          toolNames={editor.toolNames}
          onAddNode={editor.handleAddNode}
          onAddTool={editor.addToolNode}
          onClose={() => editor.setShowNodeSearch(false)}
          hasTriggerNode={editor.hasTriggerNode}
        />
      )}

      {editor.showTemplates && (
        <TemplateGallery
          onUseTemplate={(template) => {
            const { nodes: rfNodes, edges: rfEdges } = convertDefinitionToReactFlow(
              template.definition as WorkflowDefinition,
              editor.toolNames
            );
            const styledEdges = rfEdges.map((e) => ({
              ...e,
              ...getEdgeLabelProps(e.sourceHandle),
            }));
            const maxId = rfNodes.reduce((max, n) => {
              const num = parseInt(n.id.replace('node_', ''), 10);
              return isNaN(num) ? max : Math.max(max, num);
            }, 0);
            editor.nodeIdCounter.current = maxId;
            editor.setNodes(rfNodes);
            editor.setEdges(styledEdges);
            if (template.definition.name) editor.setWorkflowName(template.definition.name);
            editor.setHasUnsavedChanges(true);
            editor.setShowTemplates(false);
            editor.toast.success(`Template "${template.name}" applied`);
          }}
          onClose={() => editor.setShowTemplates(false)}
        />
      )}

      {editor.showSource && (
        <WorkflowSourceModal
          workflowName={editor.workflowName}
          nodes={editor.nodes}
          edges={editor.edges}
          variables={editor.variables}
          onClose={() => editor.setShowSource(false)}
          onImport={editor.handleImportWorkflow}
        />
      )}
    </div>
  );
}
