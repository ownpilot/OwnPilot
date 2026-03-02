/**
 * Browser Tools
 *
 * LLM-callable tools for headless browser automation.
 * Navigate pages, interact with elements, take screenshots, extract data.
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';
import { getBrowserService } from '../services/browser-service.js';

// ============================================================================
// Tool Definitions
// ============================================================================

const browseWebDef: ToolDefinition = {
  name: 'browse_web',
  brief: 'Navigate to a URL and read the rendered page',
  description:
    'Opens a URL in a headless browser, waits for the page to load (including JavaScript), ' +
    'and returns the page title and visible text content. Use this instead of fetch_web_page ' +
    'when you need to read JavaScript-rendered content (SPAs, dynamic pages).',
  category: 'Browser',
  tags: ['browser', 'web', 'navigate', 'page'],
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to (must be http or https)',
      },
    },
    required: ['url'],
  },
};

const browserClickDef: ToolDefinition = {
  name: 'browser_click',
  brief: 'Click an element on the current page',
  description:
    'Clicks an element matching the given CSS selector on the current browser page. ' +
    'You must have navigated to a page first using browse_web.',
  category: 'Browser',
  tags: ['browser', 'click', 'interact'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to click (e.g., "button.submit", "#login-btn")',
      },
    },
    required: ['selector'],
  },
};

const browserTypeDef: ToolDefinition = {
  name: 'browser_type',
  brief: 'Type text into an input field',
  description:
    'Types text into an input element matching the given CSS selector. ' +
    'Clears the existing value first. You must have navigated to a page first.',
  category: 'Browser',
  tags: ['browser', 'type', 'input', 'form'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the input field (e.g., "input[name=email]", "#search-box")',
      },
      text: {
        type: 'string',
        description: 'The text to type into the field',
      },
    },
    required: ['selector', 'text'],
  },
};

const browserFillFormDef: ToolDefinition = {
  name: 'browser_fill_form',
  brief: 'Fill multiple form fields at once',
  description:
    'Fills multiple form fields on the current page. Each field is specified by a CSS selector ' +
    'and a value. The system automatically checks for PII (email, phone, SSN, etc.) in field ' +
    'values and will include warnings if sensitive data is detected.',
  category: 'Browser',
  tags: ['browser', 'form', 'fill', 'input'],
  parameters: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description: 'Array of fields to fill, each with a selector and value',
        items: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of the form field' },
            value: { type: 'string', description: 'Value to enter' },
          },
          required: ['selector', 'value'],
        },
      },
    },
    required: ['fields'],
  },
};

const browserScreenshotDef: ToolDefinition = {
  name: 'browser_screenshot',
  brief: 'Take a screenshot of the current page',
  description:
    'Captures a PNG screenshot of the current browser page. Returns a base64-encoded image. ' +
    'Optionally capture the full scrollable page or a specific element.',
  category: 'Browser',
  tags: ['browser', 'screenshot', 'capture', 'image'],
  parameters: {
    type: 'object',
    properties: {
      fullPage: {
        type: 'boolean',
        description: 'Capture the full scrollable page instead of just the viewport (default: false)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector of a specific element to screenshot (optional)',
      },
    },
  },
};

const browserExtractDef: ToolDefinition = {
  name: 'browser_extract',
  brief: 'Extract text or structured data from the page',
  description:
    'Extracts content from the current browser page. Can extract plain text (from the whole ' +
    'page or a specific element) or structured data by providing a map of names to CSS selectors.',
  category: 'Browser',
  tags: ['browser', 'extract', 'scrape', 'data'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to extract text from (optional — extracts full page if omitted)',
      },
      dataSelectors: {
        type: 'object',
        description:
          'Map of field names to CSS selectors for structured extraction. ' +
          'Example: {"title": "h1", "price": ".price-tag", "description": ".desc"}',
        additionalProperties: { type: 'string' },
      },
    },
  },
};

export const BROWSER_TOOLS: ToolDefinition[] = [
  browseWebDef,
  browserClickDef,
  browserTypeDef,
  browserFillFormDef,
  browserScreenshotDef,
  browserExtractDef,
];

export const BROWSER_TOOL_NAMES = BROWSER_TOOLS.map((t) => t.name);

// ============================================================================
// Executor
// ============================================================================

export async function executeBrowserTool(
  toolName: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getBrowserService();

  // Check availability for all tools
  if (!(await service.isAvailable())) {
    return {
      success: false,
      error:
        'Browser is not available. Chrome/Chromium is not installed or PUPPETEER_EXECUTABLE_PATH is not set.',
    };
  }

  const uid = userId ?? 'default';

  try {
    switch (toolName) {
      case 'browse_web': {
        const url = args.url as string;
        if (!url) return { success: false, error: 'url is required' };
        const result = await service.navigate(uid, url);
        return {
          success: true,
          result: {
            url: result.url,
            title: result.title,
            text: result.text,
          },
        };
      }

      case 'browser_click': {
        const selector = args.selector as string;
        if (!selector) return { success: false, error: 'selector is required' };
        const result = await service.click(uid, selector);
        return { success: true, result };
      }

      case 'browser_type': {
        const selector = args.selector as string;
        const text = args.text as string;
        if (!selector || !text) return { success: false, error: 'selector and text are required' };
        const result = await service.type(uid, selector, text);
        return { success: true, result };
      }

      case 'browser_fill_form': {
        const fields = args.fields as { selector: string; value: string }[];
        if (!Array.isArray(fields) || fields.length === 0) {
          return { success: false, error: 'fields array is required and must not be empty' };
        }
        const result = await service.fillForm(uid, fields);
        return {
          success: true,
          result: {
            url: result.url,
            title: result.title,
            piiWarnings: result.piiWarnings.length > 0 ? result.piiWarnings : undefined,
          },
        };
      }

      case 'browser_screenshot': {
        const result = await service.screenshot(uid, {
          fullPage: args.fullPage as boolean | undefined,
          selector: args.selector as string | undefined,
        });
        return {
          success: true,
          result: {
            url: result.url,
            title: result.title,
            screenshot: `data:image/png;base64,${result.screenshot}`,
          },
        };
      }

      case 'browser_extract': {
        const dataSelectors = args.dataSelectors as Record<string, string> | undefined;
        if (dataSelectors && typeof dataSelectors === 'object') {
          const result = await service.extractData(uid, dataSelectors);
          return { success: true, result };
        }
        const result = await service.extractText(uid, args.selector as string | undefined);
        return { success: true, result };
      }

      default:
        return { success: false, error: `Unknown browser tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}
