/**
 * Artifact Tools
 *
 * LLM tools for creating and managing artifacts — AI-generated
 * interactive content (HTML, SVG, Markdown, charts, forms)
 * with optional data bindings to personal data.
 */

import { type ToolDefinition, type DataBinding, getErrorMessage } from '@ownpilot/core';
import { getArtifactService } from '../services/artifact-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const createArtifactDef: ToolDefinition = {
  name: 'create_artifact',
  workflowUsable: false,
  description: `Create an interactive artifact — rendered HTML, SVG, Markdown, form, or chart.

Use this tool when the user asks for:
- Data visualizations (charts, dashboards, graphs)
- Interactive forms or calculators
- Visual content (SVG diagrams, infographics)
- Formatted reports or documents
- Summary cards or status boards

The content field should contain the full renderable content:
- html: Complete HTML document (scripts allowed in sandbox)
- svg: SVG markup
- markdown: Markdown text
- form: JSON form schema
- chart: HTML with Chart.js or inline charts

Data bindings connect artifacts to live personal data. When refreshed,
bound variables are injected as window.__DATA__ in the iframe.`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short, descriptive title for the artifact (max 200 chars)',
      },
      type: {
        type: 'string',
        enum: ['html', 'svg', 'markdown', 'form', 'chart'],
        description: 'Content type of the artifact',
      },
      content: {
        type: 'string',
        description: 'The full renderable content (HTML, SVG, Markdown, JSON form schema, etc.)',
      },
      data_bindings: {
        type: 'array',
        description:
          'Optional data bindings that connect the artifact to live data. Each binding has an id, variableName, and source.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique binding ID' },
            variableName: {
              type: 'string',
              description: 'Variable name accessible via window.__DATA__[variableName]',
            },
            source: {
              type: 'object',
              description:
                'Data source: {type: "query", entity: "tasks", filter: {...}} or {type: "aggregate", entity: "tasks", operation: "count"} or {type: "goal", goalId: "..."} or {type: "memory", query: "..."}',
            },
            refreshInterval: {
              type: 'number',
              description: 'Auto-refresh interval in seconds (optional)',
            },
          },
          required: ['id', 'variableName', 'source'],
        },
      },
      pin_to_dashboard: {
        type: 'boolean',
        description: 'Pin this artifact to the dashboard (default: false)',
      },
      dashboard_size: {
        type: 'string',
        enum: ['small', 'medium', 'large', 'full'],
        description: 'Dashboard card size when pinned (default: medium)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for categorization',
      },
    },
    required: ['title', 'type', 'content'],
  },
  category: 'Artifacts',
};

const updateArtifactDef: ToolDefinition = {
  name: 'update_artifact',
  workflowUsable: false,
  description:
    'Update an existing artifact. Can change title, content, data bindings, pin status, or tags. Creates a version snapshot when content changes.',
  parameters: {
    type: 'object',
    properties: {
      artifact_id: {
        type: 'string',
        description: 'ID of the artifact to update',
      },
      title: { type: 'string', description: 'New title' },
      content: { type: 'string', description: 'New content (creates a new version)' },
      data_bindings: {
        type: 'array',
        description: 'Replacement data bindings array',
        items: { type: 'object' },
      },
      pinned: { type: 'boolean', description: 'Pin or unpin from dashboard' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Replacement tags array',
      },
    },
    required: ['artifact_id'],
  },
  category: 'Artifacts',
};

const listArtifactsDef: ToolDefinition = {
  name: 'list_artifacts',
  workflowUsable: false,
  description: 'List artifacts with optional filters by type, pinned status, or search query.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['html', 'svg', 'markdown', 'form', 'chart'],
        description: 'Filter by artifact type',
      },
      pinned: { type: 'boolean', description: 'Filter by pinned status' },
      search: { type: 'string', description: 'Search in title and content' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
  },
  category: 'Artifacts',
};

export const ARTIFACT_TOOLS: ToolDefinition[] = [
  createArtifactDef,
  updateArtifactDef,
  listArtifactsDef,
];

export const ARTIFACT_TOOL_NAMES = ARTIFACT_TOOLS.map((t) => t.name);

// =============================================================================
// Executor
// =============================================================================

export async function executeArtifactTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  conversationId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getArtifactService();

  switch (toolName) {
    case 'create_artifact': {
      try {
        const artifact = await service.createArtifact(userId, {
          conversationId,
          type: args.type as 'html' | 'svg' | 'markdown' | 'form' | 'chart',
          title: args.title as string,
          content: args.content as string,
          dataBindings: args.data_bindings as DataBinding[] | undefined,
          pinToDashboard: args.pin_to_dashboard as boolean | undefined,
          dashboardSize: args.dashboard_size as 'small' | 'medium' | 'large' | 'full' | undefined,
          tags: args.tags as string[] | undefined,
        });

        // Resolve initial data bindings if present
        if (artifact.dataBindings.length > 0) {
          await service.refreshBindings(userId, artifact.id);
        }

        return {
          success: true,
          result: {
            id: artifact.id,
            type: artifact.type,
            title: artifact.title,
            version: artifact.version,
            pinned: artifact.pinned,
            message: `Artifact "${artifact.title}" created (${artifact.type}). ${artifact.pinned ? 'Pinned to dashboard.' : ''}`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'update_artifact': {
      const artifactId = args.artifact_id as string;
      try {
        const updated = await service.updateArtifact(userId, artifactId, {
          title: args.title as string | undefined,
          content: args.content as string | undefined,
          dataBindings: args.data_bindings as DataBinding[] | undefined,
          pinned: args.pinned as boolean | undefined,
          tags: args.tags as string[] | undefined,
        });

        if (!updated) {
          return { success: false, error: `Artifact not found: ${artifactId}` };
        }

        return {
          success: true,
          result: {
            id: updated.id,
            title: updated.title,
            version: updated.version,
            message: `Artifact "${updated.title}" updated (v${updated.version}).`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'list_artifacts': {
      const { artifacts, total } = await service.listArtifacts(userId, {
        type: args.type as 'html' | 'svg' | 'markdown' | 'form' | 'chart' | undefined,
        pinned: args.pinned as boolean | undefined,
        search: args.search as string | undefined,
        limit: (args.limit as number) ?? 20,
      });

      return {
        success: true,
        result: {
          total,
          artifacts: artifacts.map((a) => ({
            id: a.id,
            type: a.type,
            title: a.title,
            version: a.version,
            pinned: a.pinned,
            tags: a.tags,
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
          })),
        },
      };
    }

    default:
      return { success: false, error: `Unknown artifact tool: ${toolName}` };
  }
}
