/**
 * MobileWorkflowView — Mobile-optimized workflow editor layout.
 *
 * Replaces the three-panel desktop layout (ToolPalette | Canvas | ConfigPanel)
 * with a single-panel tabbed view for small screens.
 *
 * Extra panels (Variables, Copilot, InputParams, Versions) are rendered
 * as full-content overlays when toggled from the toolbar, maintaining the
 * same UX as desktop but filling the whole screen.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from '@xyflow/react';
import type { WorkflowDefinition } from '../../components/workflows/workflowDefinition';
import { ToolPalette } from '../../components/workflows/ToolPalette';
import { NodeConfigPanel } from '../../components/workflows/NodeConfigPanel';
import { VariablesPanel } from '../../components/workflows/VariablesPanel';

const WorkflowCopilotPanel = lazy(() =>
  import('../../components/workflows/WorkflowCopilotPanel').then((m) => ({
    default: m.WorkflowCopilotPanel,
  }))
);
const InputParametersPanel = lazy(() =>
  import('../../components/workflows/InputParametersPanel').then((m) => ({
    default: m.InputParametersPanel,
  }))
);
const WorkflowVersionsPanel = lazy(() =>
  import('../../components/workflows/WorkflowVersionsPanel').then((m) => ({
    default: m.WorkflowVersionsPanel,
  }))
);

/** Subset of the useWorkflowEditor return type needed by MobileWorkflowView */
interface WorkflowEditorHandle {
  addToolNode: (toolName: string) => void;
  handleAddNode: (nodeType: string) => void;
  hasTriggerNode: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedNode: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upstreamNodes: any[];
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  deleteNode: (id: string) => void;
  setSelectedNodeId: (id: string | null) => void;
  // Extra panels
  showVariables?: boolean;
  setShowVariables?: (v: boolean) => void;
  showCopilot?: boolean;
  setShowCopilot?: (v: boolean) => void;
  showInputParams?: boolean;
  setShowInputParams?: (v: boolean) => void;
  showVersions?: boolean;
  setShowVersions?: (v: boolean) => void;
  variables?: Record<string, unknown>;
  handleVariablesChange?: (vars: Record<string, unknown>) => void;
  inputSchema?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'json';
    required: boolean;
    defaultValue?: string;
  }>;
  setInputSchema?: (
    schema: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'json';
      required: boolean;
      defaultValue?: string;
    }>
  ) => void;
  setHasUnsavedChanges?: (v: boolean) => void;
  id?: string;
  workflowName?: string;
  toolNames?: string[];
  nodes?: ReactFlowNode[];
  edges?: ReactFlowEdge[];
  handleApplyWorkflow?: (definition: WorkflowDefinition) => Promise<void>;
}

// Inline SVG icons
function NodesIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
function CanvasIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18M9 3v18" />
    </svg>
  );
}
function ConfigIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function BackHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <button
        onClick={onClose}
        className="p-1 rounded-md text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
        aria-label="Back"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
        {title}
      </span>
    </div>
  );
}

type MobileTab = 'nodes' | 'canvas' | 'config';

interface MobileWorkflowViewProps {
  editor: WorkflowEditorHandle;
  canvas: ReactNode;
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

export function MobileWorkflowView({
  editor,
  canvas,
  activeTab,
  onTabChange,
}: MobileWorkflowViewProps) {
  const hasSelection = editor.selectedNode != null;

  // Show external panel overlay when active
  const activePanel = editor.showVariables
    ? 'variables'
    : editor.showCopilot
      ? 'copilot'
      : editor.showInputParams
        ? 'input-params'
        : editor.showVersions
          ? 'versions'
          : null;

  if (activePanel) {
    return (
      <div className="flex flex-col h-full">
        <PanelBackHeader
          panel={activePanel}
          editor={editor}
        />
        <div className="flex-1 overflow-y-auto">
          <PanelContent panel={activePanel} editor={editor} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'nodes' && (
          <ToolPalette
            className="w-full border-r-0"
            onAddTool={editor.addToolNode}
            onAddNode={editor.handleAddNode}
            hasTriggerNode={editor.hasTriggerNode}
          />
        )}

        {activeTab === 'canvas' && (
          <div className="w-full h-full min-h-[300px]">{canvas}</div>
        )}

        {activeTab === 'config' &&
          (hasSelection ? (
            <NodeConfigPanel
              node={editor.selectedNode}
              upstreamNodes={editor.upstreamNodes}
              onUpdate={editor.updateNodeData}
              onDelete={editor.deleteNode}
              onClose={() => editor.setSelectedNodeId(null)}
              className="w-full border-l-0"
            />
          ) : (
            <div className="flex items-center justify-center h-full p-8 text-center">
              <div className="text-text-muted dark:text-dark-text-muted">
                <ConfigIcon />
                <p className="mt-2 text-sm">Select a node to configure</p>
              </div>
            </div>
          ))}
      </div>

      {/* Bottom tab bar */}
      <div className="flex-shrink-0 flex border-t border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        {([
          { id: 'nodes' as const, label: 'Nodes', icon: <NodesIcon /> },
          { id: 'canvas' as const, label: 'Canvas', icon: <CanvasIcon /> },
          { id: 'config' as const, label: 'Config', icon: <ConfigIcon /> },
        ] satisfies { id: MobileTab; label: string; icon: ReactNode }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center py-2 text-[10px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-primary border-t-2 border-primary bg-primary/5'
                : 'text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            {tab.icon}
            <span className="mt-0.5">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Panel overlay helpers ----

function panelLabel(panel: string): string {
  switch (panel) {
    case 'variables':
      return 'Variables';
    case 'copilot':
      return 'AI Copilot';
    case 'input-params':
      return 'Input Parameters';
    case 'versions':
      return 'Version History';
    default:
      return 'Panel';
  }
}

function PanelBackHeader({
  panel,
  editor,
}: {
  panel: string;
  editor: WorkflowEditorHandle;
}) {
  const onClose = () => {
    switch (panel) {
      case 'variables':
        editor.setShowVariables?.(false);
        break;
      case 'copilot':
        editor.setShowCopilot?.(false);
        break;
      case 'input-params':
        editor.setShowInputParams?.(false);
        break;
      case 'versions':
        editor.setShowVersions?.(false);
        break;
    }
  };

  return <BackHeader title={panelLabel(panel)} onClose={onClose} />;
}

function PanelContent({
  panel,
  editor,
}: {
  panel: string;
  editor: WorkflowEditorHandle;
}) {
  switch (panel) {
    case 'variables':
      return (
        <VariablesPanel
          variables={editor.variables ?? {}}
          onChange={(vars) => {
            editor.handleVariablesChange?.(vars);
          }}
          onClose={() => editor.setShowVariables?.(false)}
          className="w-full"
        />
      );
    case 'copilot':
      return (
        <Suspense
          fallback={
            <div className="flex items-center justify-center p-8 text-sm text-text-muted">
              Loading...
            </div>
          }
        >
          <WorkflowCopilotPanel
            workflowName={editor.workflowName ?? ''}
            nodes={editor.nodes ?? []}
            edges={editor.edges ?? []}
            availableToolNames={editor.toolNames ?? []}
            onApplyWorkflow={(data) => {
              editor.handleApplyWorkflow?.(data as WorkflowDefinition);
            }}
            onClose={() => editor.setShowCopilot?.(false)}
          />
        </Suspense>
      );
    case 'input-params':
      return (
        <Suspense fallback={null}>
          <InputParametersPanel
            parameters={editor.inputSchema ?? []}
            onChange={(params) => {
              editor.setInputSchema?.(params);
              editor.setHasUnsavedChanges?.(true);
            }}
            onClose={() => editor.setShowInputParams?.(false)}
          />
        </Suspense>
      );
    case 'versions':
      return editor.id ? (
        <Suspense fallback={null}>
          <WorkflowVersionsPanel
            workflowId={editor.id}
            onRestore={() => {}}
            onClose={() => editor.setShowVersions?.(false)}
            className="w-full"
          />
        </Suspense>
      ) : null;
    default:
      return null;
  }
}
