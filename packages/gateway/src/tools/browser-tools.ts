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
        description:
          'Capture the full scrollable page instead of just the viewport (default: false)',
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

const browserWaitForDef: ToolDefinition = {
  name: 'browser_wait_for',
  brief: 'Wait for an element to appear or for a fixed delay',
  description:
    'Pauses until a CSS selector becomes present on the page (preferred), or ' +
    'waits a fixed timeout if no selector is given. Essential for SPAs and ' +
    'pages where content loads asynchronously after navigation or interaction. ' +
    'Use this before browser_click / browser_extract when the target element ' +
    'may not be present yet.',
  category: 'Browser',
  tags: ['browser', 'wait', 'selector', 'spa'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description:
          'CSS selector to wait for (preferred). Resolves as soon as the element exists.',
      },
      timeoutMs: {
        type: 'number',
        description:
          'Max time to wait in milliseconds (default 5000). Also doubles as the pure-delay duration when no selector is given (capped at 10000).',
      },
    },
  },
};

const browserScrollDef: ToolDefinition = {
  name: 'browser_scroll',
  brief: 'Scroll the page up or down',
  description:
    'Scrolls the current page by a pixel amount. Use this to reveal lazy-loaded ' +
    'content (infinite-scroll lists, off-screen sections, dynamic comment threads) ' +
    'before extracting or clicking.',
  category: 'Browser',
  tags: ['browser', 'scroll', 'page'],
  parameters: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        description: 'Scroll direction.',
      },
      pixels: {
        type: 'number',
        description: 'Pixels to scroll (default 500).',
      },
    },
    required: ['direction'],
  },
};

const browserSelectDef: ToolDefinition = {
  name: 'browser_select',
  brief: 'Choose an option in a <select> dropdown',
  description:
    'Selects an option by its value attribute in a native <select> dropdown. ' +
    'Use this for form fields that present a list of choices — e.g. country pickers, ' +
    'sort orders, filter dropdowns.',
  category: 'Browser',
  tags: ['browser', 'select', 'dropdown', 'form'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector for the <select> element.',
      },
      value: {
        type: 'string',
        description:
          "The option's value attribute to select (NOT its visible label — look at the <option value='...'> attribute).",
      },
    },
    required: ['selector', 'value'],
  },
};

const browserPressKeyDef: ToolDefinition = {
  name: 'browser_press_key',
  brief: 'Press a single keyboard key (Enter, Tab, Escape, etc.)',
  description:
    'Sends a keyboard key press to the active page. Supports single characters ' +
    '("a", "1") and named keys (Enter, Tab, Escape, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, ' +
    'Backspace, Delete). Essential for search bars that submit on Enter, modals ' +
    'that close on Esc, and any keyboard-driven UI element.',
  category: 'Browser',
  tags: ['browser', 'keyboard', 'key', 'press'],
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key to press. Examples: "Enter", "Tab", "Escape", "ArrowDown", "a".',
      },
      selector: {
        type: 'string',
        description:
          'Optional CSS selector — when supplied the element is focused before the key fires.',
      },
    },
    required: ['key'],
  },
};

const browserGetStateDef: ToolDefinition = {
  name: 'browser_get_state',
  brief: 'Read the current URL + title without acting on the page',
  description:
    "Returns the active page's current URL and title without performing any action. " +
    'Use this to verify that a previous click or form submission landed where ' +
    'you expected before proceeding. Returns null when no page is open.',
  category: 'Browser',
  tags: ['browser', 'state', 'inspect'],
  parameters: {
    type: 'object',
    properties: {},
  },
};

const browserAccessibilityTreeDef: ToolDefinition = {
  name: 'browser_accessibility_tree',
  brief: 'Get the page as a structured accessibility (role/name) outline',
  description:
    'Returns the current page as an accessibility tree — a compact, indented outline of ' +
    'roles and names (button, link, textbox, heading, …) instead of raw HTML. This is the ' +
    'best way to understand page structure and find interactive elements to click/type into: ' +
    'it is far smaller than HTML and surfaces exactly what is actionable. Optionally pass a ' +
    'selector to scope the tree to a subtree.',
  category: 'Browser',
  tags: ['browser', 'accessibility', 'a11y', 'structure', 'navigate', 'inspect'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'Optional CSS selector to scope the tree to a single subtree.',
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
  browserWaitForDef,
  browserScrollDef,
  browserSelectDef,
  browserPressKeyDef,
  browserGetStateDef,
  browserAccessibilityTreeDef,
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

      case 'browser_wait_for': {
        const selector = args.selector as string | undefined;
        const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined;
        const result = await service.wait(uid, selector, timeoutMs);
        return { success: true, result };
      }

      case 'browser_scroll': {
        const direction = args.direction as 'up' | 'down' | undefined;
        if (direction !== 'up' && direction !== 'down') {
          return { success: false, error: 'direction must be "up" or "down"' };
        }
        const pixels = typeof args.pixels === 'number' ? args.pixels : undefined;
        const result = await service.scroll(uid, direction, pixels);
        return { success: true, result };
      }

      case 'browser_select': {
        const selector = args.selector as string;
        const value = args.value as string;
        if (!selector || typeof value !== 'string') {
          return { success: false, error: 'selector and value are required' };
        }
        const result = await service.select(uid, selector, value);
        return { success: true, result };
      }

      case 'browser_press_key': {
        const key = args.key as string;
        if (!key) return { success: false, error: 'key is required' };
        const selector = args.selector as string | undefined;
        const result = await service.pressKey(uid, key, selector);
        return { success: true, result };
      }

      case 'browser_get_state': {
        const result = await service.getState(uid);
        return { success: true, result };
      }

      case 'browser_accessibility_tree': {
        const result = await service.accessibilityTree(uid, args.selector as string | undefined);
        return { success: true, result };
      }

      default:
        return { success: false, error: `Unknown browser tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}
