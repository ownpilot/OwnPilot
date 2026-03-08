/**
 * WorkflowEditorToolbar — header/toolbar for the workflow editor.
 */

import type { Node } from '@xyflow/react';

import {
  ChevronLeft,
  Save,
  Play,
  StopCircle,
  Code,
  Sparkles,
  LayoutDashboard,
  ListChecks,
  FlaskConical,
  History,
  Settings,
  Layout,
} from '../../components/icons';

export interface WorkflowEditorToolbarProps {
  workflowName: string;
  setWorkflowName: (name: string) => void;
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (v: boolean) => void;
  isSaving: boolean;
  isExecuting: boolean;
  isDryRun: boolean;
  nodes: Node[];
  variables: Record<string, unknown>;
  inputSchema: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'json';
    required: boolean;
    defaultValue?: string;
    description?: string;
  }>;
  showVariables: boolean;
  setShowVariables: (v: boolean) => void;
  showCopilot: boolean;
  setShowCopilot: (v: boolean) => void;
  showVersions: boolean;
  setShowVersions: (v: boolean) => void;
  showInputParams: boolean;
  setShowInputParams: (v: boolean) => void;
  setShowTemplates: (v: boolean) => void;
  setShowSource: (v: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  navigate: (path: string) => void;
  handleSave: () => void;
  handleArrange: () => void;
  handleExecute: (dryRun: boolean) => void;
  handleCancel: () => void;
}

export function WorkflowEditorToolbar({
  workflowName,
  setWorkflowName,
  hasUnsavedChanges,
  setHasUnsavedChanges,
  isSaving,
  isExecuting,
  isDryRun,
  nodes,
  variables,
  inputSchema,
  showVariables,
  setShowVariables,
  showCopilot,
  setShowCopilot,
  showVersions,
  setShowVersions,
  showInputParams,
  setShowInputParams,
  setShowTemplates,
  setShowSource,
  setSelectedNodeId,
  navigate,
  handleSave,
  handleArrange,
  handleExecute,
  handleCancel,
}: WorkflowEditorToolbarProps) {
  return (
    <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <button
        onClick={() => navigate('/workflows')}
        className="p-1.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        title="Back to Workflows"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <input
        type="text"
        value={workflowName}
        onChange={(e) => {
          setWorkflowName(e.target.value);
          setHasUnsavedChanges(true);
        }}
        className="flex-1 text-sm font-semibold bg-transparent text-text-primary dark:text-dark-text-primary border-none focus:outline-none focus:ring-0 min-w-0"
        placeholder="Workflow name..."
      />

      {hasUnsavedChanges && <span className="text-xs text-warning">Unsaved</span>}

      <button
        onClick={handleSave}
        disabled={isSaving || !hasUnsavedChanges}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors disabled:opacity-50"
      >
        <Save className="w-3.5 h-3.5" />
        {isSaving ? 'Saving...' : 'Save'}
      </button>

      <button
        onClick={handleArrange}
        disabled={nodes.length === 0 || isExecuting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors disabled:opacity-50"
        title="Auto-arrange nodes"
      >
        <LayoutDashboard className="w-3.5 h-3.5" />
        Arrange
      </button>

      <button
        onClick={() => setShowSource(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
        title="View workflow source"
      >
        <Code className="w-3.5 h-3.5" />
        Source
      </button>

      <button
        onClick={() => {
          setShowVariables(!showVariables);
          if (!showVariables) {
            setShowCopilot(false);
            setShowVersions(false);
            setSelectedNodeId(null);
          }
        }}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          showVariables
            ? 'bg-primary text-white'
            : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
        }`}
        title={showVariables ? 'Hide Variables' : 'Edit workflow variables'}
      >
        <ListChecks className="w-3.5 h-3.5" />
        Variables
        {Object.keys(variables).length > 0 && (
          <span className="ml-0.5 px-1.5 py-0 text-[10px] bg-white/20 rounded-full">
            {Object.keys(variables).length}
          </span>
        )}
      </button>

      <button
        onClick={() => {
          setShowInputParams(!showInputParams);
          if (!showInputParams) {
            setShowCopilot(false);
            setShowVariables(false);
            setShowVersions(false);
            setSelectedNodeId(null);
          }
        }}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          showInputParams
            ? 'bg-primary text-white'
            : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
        }`}
        title={showInputParams ? 'Hide Input Parameters' : 'Define workflow input parameters'}
      >
        <Settings className="w-3.5 h-3.5" />
        Inputs
        {inputSchema.length > 0 && (
          <span className="ml-0.5 px-1.5 py-0 text-[10px] bg-white/20 rounded-full">
            {inputSchema.length}
          </span>
        )}
      </button>

      <button
        onClick={() => setShowTemplates(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
        title="Import from template gallery"
      >
        <Layout className="w-3.5 h-3.5" />
        Templates
      </button>

      <button
        onClick={() => {
          setShowVersions(!showVersions);
          if (!showVersions) {
            setShowCopilot(false);
            setShowVariables(false);
            setSelectedNodeId(null);
          }
        }}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          showVersions
            ? 'bg-primary text-white'
            : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
        }`}
        title={showVersions ? 'Hide Versions' : 'Version history'}
      >
        <History className="w-3.5 h-3.5" />
        Versions
      </button>

      <button
        onClick={() => {
          setShowCopilot(!showCopilot);
          if (!showCopilot) {
            setShowVariables(false);
            setShowVersions(false);
            setSelectedNodeId(null);
          }
        }}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          showCopilot
            ? 'bg-primary text-white'
            : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
        }`}
        title={
          showCopilot ? 'Hide Copilot' : 'AI Copilot — build workflows with natural language'
        }
      >
        <Sparkles className="w-3.5 h-3.5" />
        Copilot
      </button>

      {isExecuting ? (
        <button
          onClick={handleCancel}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 rounded-md transition-colors ${isDryRun ? 'bg-warning' : 'bg-error'}`}
        >
          <StopCircle className="w-3.5 h-3.5" />
          {isDryRun ? 'Cancel Test' : 'Cancel'}
        </button>
      ) : (
        <>
          <button
            onClick={() => handleExecute(true)}
            disabled={nodes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-warning/15 text-warning hover:bg-warning/25 border border-warning/30 rounded-md transition-colors disabled:opacity-50"
            title="Dry-run: resolve templates without executing side-effect nodes (LLM, HTTP, Delay, Tool)"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Test Run
          </button>
          <button
            onClick={() => handleExecute(false)}
            disabled={nodes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-dark rounded-md transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            Execute
          </button>
        </>
      )}
    </header>
  );
}
