/**
 * Shared ToolPicker types.
 *
 * Extracted from ToolPicker.tsx so the data table, tab config, icon helpers and
 * instruction builders can live in their own modules without importing the
 * component. ToolPicker re-exports `ResourceType` and `ResourceAttachment` so
 * existing consumers (ChatInput) keep their import path.
 */

export type ResourceType =
  | 'tool'
  | 'custom-tool'
  | 'custom-data'
  | 'builtin-data'
  | 'skill'
  | 'file'
  | 'url'
  | 'composio-action'
  | 'mcp-tool'
  | 'artifact'
  | 'prompt';

export type TabId =
  | 'tools'
  | 'custom-data'
  | 'builtin-data'
  | 'skills'
  | 'files'
  | 'url'
  | 'composio'
  | 'mcp'
  | 'artifacts'
  | 'prompts';

export interface ResourceAttachment {
  name: string;
  displayName?: string;
  internalName?: string;
  type: ResourceType;
  toolInstructions: string;
  /** For 'prompt' type — prepended to user message instead of context block */
  promptText?: string;
}

export interface ResourceItem {
  name: string;
  displayName?: string;
  internalName?: string;
  description: string;
  category?: string;
  type: ResourceType;
  recordCount?: number;
  parameters?: Record<string, unknown>;
  instructions?: string;
}

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}
