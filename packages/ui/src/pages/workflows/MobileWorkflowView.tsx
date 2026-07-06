/**
 * MobileWorkflowView — Mobile-optimized workflow editor layout.
 *
 * Replaces the three-panel desktop layout (ToolPalette | Canvas | ConfigPanel)
 * with a single-panel tabbed view for small screens:
 *   - "Nodes" tab:  compact ToolPalette (add/search nodes)
 *   - "Canvas" tab: simplified ReactFlow read-only view
 *   - "Config" tab: NodeConfigPanel for the selected node
 *
 * Desktop users see the original three-panel layout unchanged.
 * Mobile detection uses useIsMobile (768px breakpoint).
 */

import { type ReactNode } from 'react';
import { ToolPalette } from '../../components/workflows/ToolPalette';
import { NodeConfigPanel } from '../../components/workflows/NodeConfigPanel';

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
}

// Icons as inline SVGs to avoid importing the full icon barrel
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
