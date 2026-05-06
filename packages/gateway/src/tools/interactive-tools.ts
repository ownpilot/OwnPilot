/**
 * Interactive Tools
 *
 * Tools for delivering structured widgets and suggestions to the chat UI.
 * The agent calls deliver_interactive to push interactive elements (tables,
 * cards, metrics, suggestion chips) that render alongside the text response.
 *
 * Format: marker-based (streaming-friendly, unambiguous HTML comments)
 *   <!--WIDGET#1#type#{"json":"data"}<!--WIDGET#1#END-->
 *   <!--SUGGESTIONS#START-->[{"title":"A","detail":"B"}]<!--SUGGESTIONS#END-->
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';

// =============================================================================
// Tool Definitions
// =============================================================================

const INTERACTIVE_TOOL_DEF: ToolDefinition = {
  name: 'deliver_interactive',
  description:
    'Deliver structured interactive elements (widgets and suggestion chips) alongside a text response. ' +
    'Widgets render as rich UI components (table, metric_grid, cards, callout, etc.) inline in the chat. ' +
    'Suggestions appear as clickable chips below the message — clicking fills the chat input. ' +
    'Call this tool when you want to show structured data or offer follow-up actions. ' +
    'The marker format is streaming-safe and survives partial delivery.',
  parameters: {
    type: 'object',
    properties: {
      widgets: {
        type: 'array',
        description: 'Array of widget objects to render inline in the chat message.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: 'Unique numeric ID for this widget (used in marker alignment).',
            },
            type: {
              type: 'string',
              description:
                'Widget type: table, metric, metrics, metric_grid, stats, list, checklist, ' +
                'key_value, key_values, facts, details, properties, card, cards, card_grid, ' +
                'step, steps, plan, callout, note, progress, bar, bar_chart, timeline',
            },
            title: {
              type: 'string',
              description: 'Optional title displayed in the widget header.',
            },
            data: {
              type: 'object',
              description:
                'Widget payload — shape varies by type. ' +
                'table: {headers: string[], rows: string[][]} | ' +
                'metric/metrics: {title?: string, items: {label, value, detail?, tone?}[]} | ' +
                'list/checklist: {title?: string, items: {title, detail, done?}[]} | ' +
                'callout/note: {title?: string, body: string, tone: info|success|warning|danger} | ' +
                'progress: {title?: string, label: string, value: number, max?: number} | ' +
                'bar_chart: {title?: string, items: {label, value, displayValue?}[]} | ' +
                'cards: {title?: string, items: {title, detail, meta?, tone?}[]}',
            },
          },
          required: ['id', 'type', 'data'],
        },
      },
      suggestions: {
        type: 'array',
        description: 'Array of suggestion items shown as clickable chips below the message.',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Label shown on the chip (keep under 40 characters).',
            },
            detail: {
              type: 'string',
              description:
                'Text that fills the chat input when the user clicks the chip. ' +
                'Use this to provide the actual command or prompt text.',
            },
          },
          required: ['title', 'detail'],
        },
      },
    },
    required: [],
  },
  category: 'Interactive',
};

export const INTERACTIVE_TOOLS: ToolDefinition[] = [INTERACTIVE_TOOL_DEF];

// =============================================================================
// Executor
// =============================================================================

export async function executeInteractiveTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (toolName !== 'deliver_interactive') {
    return { success: false, error: `Unknown interactive tool: ${toolName}` };
  }

  const rawWidgets = args.widgets as
    | Array<{ id: number; type: string; title?: string; data: unknown }>
    | undefined;
  const rawSuggestions = args.suggestions as
    | Array<{ title: string; detail: string }>
    | undefined;

  try {
    // Build marker-text result
    const widgetMarkers: string[] = [];
    let widgetIndex = 0;

    for (const widget of rawWidgets ?? []) {
      const id = widget.id ?? widgetIndex;
      const name = (widget.type ?? 'widget').toLowerCase().trim();
      let dataObj: unknown;

      if (typeof widget.data === 'string') {
        try {
          dataObj = JSON.parse(widget.data as string);
        } catch {
          dataObj = widget.data;
        }
      } else {
        dataObj = widget.data;
      }

      const payload = JSON.stringify(dataObj);
      widgetMarkers.push(`<!--WIDGET#${id}#${name}#${payload}<!--WIDGET#${id}#END-->`);
      widgetIndex++;
    }

    let suggestionMarker = '';
    if (rawSuggestions && rawSuggestions.length > 0) {
      suggestionMarker = `<!--SUGGESTIONS#START-->${JSON.stringify(rawSuggestions)}<!--SUGGESTIONS#END-->`;
    }

    const markerText = widgetMarkers.join('\n') + (suggestionMarker ? `\n${suggestionMarker}` : '');

    return {
      success: true,
      result: {
        delivered: true,
        widgetCount: rawWidgets?.length ?? 0,
        suggestionCount: rawSuggestions?.length ?? 0,
        markerText,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}