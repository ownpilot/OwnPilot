/**
 * Code Assistant Plugin
 *
 * Provides code analysis, formatting, and utility tools.
 * Demonstrates: code execution (sandboxed), file operations
 */

import { createPlugin } from '../index.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const formatCodeTool: ToolDefinition = {
  name: 'code_format',
  description: 'Format code according to language conventions',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code to format',
      },
      language: {
        type: 'string',
        description: 'Programming language',
        enum: ['javascript', 'typescript', 'python', 'json', 'html', 'css', 'sql'],
      },
      indent: {
        type: 'number',
        description: 'Indentation size (default: 2)',
      },
    },
    required: ['code', 'language'],
  },
};

const analyzeCodeTool: ToolDefinition = {
  name: 'code_analyze',
  description: 'Analyze code for potential issues and patterns',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code to analyze',
      },
      language: {
        type: 'string',
        description: 'Programming language',
      },
      checks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific checks to run (complexity, security, style, all)',
      },
    },
    required: ['code', 'language'],
  },
};

const convertCodeTool: ToolDefinition = {
  name: 'code_convert',
  description: 'Convert code between formats (e.g., JSON to YAML)',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Input code/data',
      },
      from: {
        type: 'string',
        description: 'Source format',
        enum: ['json', 'yaml', 'xml', 'csv', 'toml'],
      },
      to: {
        type: 'string',
        description: 'Target format',
        enum: ['json', 'yaml', 'xml', 'csv', 'toml'],
      },
    },
    required: ['input', 'from', 'to'],
  },
};

const generateRegexTool: ToolDefinition = {
  name: 'code_regex',
  description: 'Generate or test regular expressions',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['test', 'explain', 'generate'],
      },
      pattern: {
        type: 'string',
        description: 'Regex pattern (for test/explain)',
      },
      testString: {
        type: 'string',
        description: 'String to test against',
      },
      description: {
        type: 'string',
        description: 'Description of what to match (for generate)',
      },
    },
    required: ['action'],
  },
};

const minifyCodeTool: ToolDefinition = {
  name: 'code_minify',
  description: 'Minify code to reduce size',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code to minify',
      },
      language: {
        type: 'string',
        description: 'Programming language',
        enum: ['javascript', 'css', 'html', 'json'],
      },
    },
    required: ['code', 'language'],
  },
};

const diffCodeTool: ToolDefinition = {
  name: 'code_diff',
  description: 'Compare two code snippets and show differences',
  parameters: {
    type: 'object',
    properties: {
      original: {
        type: 'string',
        description: 'Original code',
      },
      modified: {
        type: 'string',
        description: 'Modified code',
      },
      context: {
        type: 'number',
        description: 'Lines of context around changes (default: 3)',
      },
    },
    required: ['original', 'modified'],
  },
};

const hashTool: ToolDefinition = {
  name: 'code_hash',
  description: 'Generate hash of text/code',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Text to hash',
      },
      algorithm: {
        type: 'string',
        description: 'Hash algorithm',
        enum: ['md5', 'sha1', 'sha256', 'sha512'],
      },
    },
    required: ['input'],
  },
};

const encodeDecodeTool: ToolDefinition = {
  name: 'code_encode',
  description: 'Encode or decode text',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Text to encode/decode',
      },
      encoding: {
        type: 'string',
        description: 'Encoding type',
        enum: ['base64', 'url', 'html', 'hex'],
      },
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['encode', 'decode'],
      },
    },
    required: ['input', 'encoding', 'action'],
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

const formatCodeExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const code = params.code as string;
  const language = params.language as string;
  const indent = (params.indent as number) || 2;

  try {
    let formatted = code;

    switch (language) {
      case 'json':
        formatted = JSON.stringify(JSON.parse(code), null, indent);
        break;
      case 'javascript':
      case 'typescript':
        // Basic formatting (in production, use prettier)
        formatted = code
          .replace(/\{/g, ' {\n')
          .replace(/\}/g, '\n}\n')
          .replace(/;/g, ';\n')
          .replace(/\n\s*\n/g, '\n');
        break;
      default:
        // Return as-is with note
        return {
          content: {
            formatted: code,
            language,
            note: 'Advanced formatting requires external tools (prettier, black, etc.)',
          },
        };
    }

    return {
      content: {
        success: true,
        formatted,
        language,
        originalLength: code.length,
        formattedLength: formatted.length,
      },
    };
  } catch (error) {
    return {
      content: { error: `Failed to format: ${error}` },
      isError: true,
    };
  }
};

const analyzeCodeExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const code = params.code as string;
  const language = params.language as string;
  const checks = (params.checks as string[]) || ['all'];

  const issues: Array<{ type: string; severity: string; message: string; line?: number }> = [];
  const metrics: Record<string, number> = {};

  // Basic analysis
  const lines = code.split('\n');
  metrics.lines = lines.length;
  metrics.characters = code.length;

  // Check for common issues
  if (checks.includes('all') || checks.includes('style')) {
    // Long lines
    lines.forEach((line, i) => {
      if (line.length > 120) {
        issues.push({
          type: 'style',
          severity: 'warning',
          message: `Line exceeds 120 characters (${line.length})`,
          line: i + 1,
        });
      }
    });

    // Trailing whitespace
    lines.forEach((line, i) => {
      if (/\s+$/.test(line)) {
        issues.push({
          type: 'style',
          severity: 'info',
          message: 'Trailing whitespace',
          line: i + 1,
        });
      }
    });
  }

  if (checks.includes('all') || checks.includes('security')) {
    // Check for potential security issues
    if (/eval\s*\(/.test(code)) {
      issues.push({
        type: 'security',
        severity: 'error',
        message: 'Avoid using eval() - potential code injection risk',
      });
    }

    if (/innerHTML\s*=/.test(code)) {
      issues.push({
        type: 'security',
        severity: 'warning',
        message: 'innerHTML assignment - potential XSS risk',
      });
    }

    if (/password|secret|api[_-]?key/i.test(code)) {
      issues.push({
        type: 'security',
        severity: 'warning',
        message: 'Possible hardcoded credentials detected',
      });
    }
  }

  if (checks.includes('all') || checks.includes('complexity')) {
    // Count nesting depth
    let maxDepth = 0;
    let currentDepth = 0;
    for (const char of code) {
      if (char === '{' || char === '(') currentDepth++;
      if (char === '}' || char === ')') currentDepth--;
      maxDepth = Math.max(maxDepth, currentDepth);
    }
    metrics.maxNestingDepth = maxDepth;

    if (maxDepth > 5) {
      issues.push({
        type: 'complexity',
        severity: 'warning',
        message: `High nesting depth (${maxDepth}) - consider refactoring`,
      });
    }

    // Count functions (rough estimate)
    const functionCount = (code.match(/function\s+\w+|=>\s*{|\w+\s*\([^)]*\)\s*{/g) || []).length;
    metrics.estimatedFunctions = functionCount;
  }

  return {
    content: {
      success: true,
      language,
      metrics,
      issues,
      summary: {
        total: issues.length,
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
      },
    },
  };
};

const convertCodeExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const input = params.input as string;
  const from = params.from as string;
  const to = params.to as string;

  try {
    // Parse input
    let data: unknown;

    switch (from) {
      case 'json':
        data = JSON.parse(input);
        break;
      case 'csv':
        // Simple CSV parsing
        const lines = input.trim().split('\n');
        const headers = lines[0]?.split(',').map(h => h.trim()) || [];
        data = lines.slice(1).map(line => {
          const values = line.split(',');
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => {
            obj[h] = values[i]?.trim() || '';
          });
          return obj;
        });
        break;
      default:
        return {
          content: {
            error: `Parsing ${from} format requires additional libraries`,
            note: 'Supported conversions: JSON <-> CSV',
          },
          isError: true,
        };
    }

    // Convert to output
    let output: string;

    switch (to) {
      case 'json':
        output = JSON.stringify(data, null, 2);
        break;
      case 'csv':
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
          const headers = Object.keys(data[0] as object);
          const rows = (data as Record<string, unknown>[]).map(row =>
            headers.map(h => String(row[h] ?? '')).join(',')
          );
          output = [headers.join(','), ...rows].join('\n');
        } else {
          output = JSON.stringify(data);
        }
        break;
      default:
        return {
          content: {
            error: `Converting to ${to} format requires additional libraries`,
            note: 'Supported conversions: JSON <-> CSV',
          },
          isError: true,
        };
    }

    return {
      content: {
        success: true,
        from,
        to,
        output,
        inputLength: input.length,
        outputLength: output.length,
      },
    };
  } catch (error) {
    return {
      content: { error: `Conversion failed: ${error}` },
      isError: true,
    };
  }
};

const generateRegexExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const action = params.action as string;
  const pattern = params.pattern as string | undefined;
  const testString = params.testString as string | undefined;
  const description = params.description as string | undefined;

  switch (action) {
    case 'test':
      if (!pattern || !testString) {
        return {
          content: { error: 'Pattern and testString required for test action' },
          isError: true,
        };
      }
      try {
        const regex = new RegExp(pattern, 'g');
        const matches = testString.match(regex);
        return {
          content: {
            success: true,
            pattern,
            testString,
            matches: matches || [],
            matchCount: matches?.length || 0,
            isMatch: !!matches,
          },
        };
      } catch (error) {
        return {
          content: { error: `Invalid regex: ${error}` },
          isError: true,
        };
      }

    case 'explain':
      if (!pattern) {
        return {
          content: { error: 'Pattern required for explain action' },
          isError: true,
        };
      }
      // Basic regex explanation
      const explanations: string[] = [];
      if (pattern.includes('^')) explanations.push('^ - Start of string');
      if (pattern.includes('$')) explanations.push('$ - End of string');
      if (pattern.includes('\\d')) explanations.push('\\d - Any digit');
      if (pattern.includes('\\w')) explanations.push('\\w - Any word character');
      if (pattern.includes('\\s')) explanations.push('\\s - Any whitespace');
      if (pattern.includes('.')) explanations.push('. - Any character');
      if (pattern.includes('*')) explanations.push('* - Zero or more');
      if (pattern.includes('+')) explanations.push('+ - One or more');
      if (pattern.includes('?')) explanations.push('? - Zero or one');

      return {
        content: {
          pattern,
          explanations,
          note: 'Basic explanation - for detailed analysis use a regex visualization tool',
        },
      };

    case 'generate':
      if (!description) {
        return {
          content: { error: 'Description required for generate action' },
          isError: true,
        };
      }
      // Suggest common patterns based on description
      const suggestions: Array<{ pattern: string; description: string }> = [];
      const lower = description.toLowerCase();

      if (lower.includes('email')) {
        suggestions.push({ pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', description: 'Email address' });
      }
      if (lower.includes('phone') || lower.includes('number')) {
        suggestions.push({ pattern: '\\+?[1-9]\\d{1,14}', description: 'Phone number (E.164)' });
        suggestions.push({ pattern: '\\d{3}-\\d{3}-\\d{4}', description: 'US phone format' });
      }
      if (lower.includes('url') || lower.includes('link')) {
        suggestions.push({ pattern: 'https?://[^\\s]+', description: 'URL' });
      }
      if (lower.includes('ip')) {
        suggestions.push({ pattern: '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}', description: 'IPv4 address' });
      }
      if (lower.includes('date')) {
        suggestions.push({ pattern: '\\d{4}-\\d{2}-\\d{2}', description: 'Date (YYYY-MM-DD)' });
        suggestions.push({ pattern: '\\d{2}/\\d{2}/\\d{4}', description: 'Date (MM/DD/YYYY)' });
      }

      return {
        content: {
          description,
          suggestions,
          note: suggestions.length === 0 ? 'No matching patterns found - please be more specific' : undefined,
        },
      };

    default:
      return {
        content: { error: `Unknown action: ${action}` },
        isError: true,
      };
  }
};

const minifyCodeExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const code = params.code as string;
  const language = params.language as string;

  let minified = code;

  switch (language) {
    case 'json':
      try {
        minified = JSON.stringify(JSON.parse(code));
      } catch {
        return {
          content: { error: 'Invalid JSON' },
          isError: true,
        };
      }
      break;
    case 'javascript':
      // Basic minification (in production, use terser)
      minified = code
        .replace(/\/\/.*$/gm, '') // Remove single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
        .replace(/\s+/g, ' ') // Collapse whitespace
        .replace(/\s*([{};,:])\s*/g, '$1') // Remove space around punctuation
        .trim();
      break;
    case 'css':
      minified = code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{};:,>+~])\s*/g, '$1')
        .trim();
      break;
    case 'html':
      minified = code
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .trim();
      break;
    default:
      return {
        content: { error: `Minification not supported for ${language}` },
        isError: true,
      };
  }

  const savings = ((code.length - minified.length) / code.length * 100).toFixed(1);

  return {
    content: {
      success: true,
      minified,
      originalLength: code.length,
      minifiedLength: minified.length,
      savings: `${savings}%`,
    },
  };
};

const diffCodeExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const original = params.original as string;
  const modified = params.modified as string;
  const _context = (params.context as number) || 3;

  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const changes: Array<{ type: 'add' | 'remove' | 'same'; line: number; content: string }> = [];

  // Simple line-by-line diff
  const maxLen = Math.max(originalLines.length, modifiedLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = originalLines[i];
    const modLine = modifiedLines[i];

    if (origLine === modLine) {
      changes.push({ type: 'same', line: i + 1, content: origLine || '' });
    } else {
      if (origLine !== undefined && modLine === undefined) {
        changes.push({ type: 'remove', line: i + 1, content: origLine });
      } else if (origLine === undefined && modLine !== undefined) {
        changes.push({ type: 'add', line: i + 1, content: modLine });
      } else {
        changes.push({ type: 'remove', line: i + 1, content: origLine || '' });
        changes.push({ type: 'add', line: i + 1, content: modLine || '' });
      }
    }
  }

  const additions = changes.filter(c => c.type === 'add').length;
  const deletions = changes.filter(c => c.type === 'remove').length;

  return {
    content: {
      success: true,
      changes: changes.filter(c => c.type !== 'same'),
      summary: {
        additions,
        deletions,
        totalChanges: additions + deletions,
      },
      note: 'Basic line-by-line diff - for detailed diff use specialized tools',
    },
  };
};

const hashExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const input = params.input as string;
  const algorithm = (params.algorithm as string) || 'sha256';

  try {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash(algorithm).update(input).digest('hex');

    return {
      content: {
        success: true,
        input: input.length > 50 ? input.substring(0, 50) + '...' : input,
        algorithm,
        hash,
        length: hash.length,
      },
    };
  } catch (error) {
    return {
      content: { error: `Hashing failed: ${error}` },
      isError: true,
    };
  }
};

const encodeDecodeExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const input = params.input as string;
  const encoding = params.encoding as string;
  const action = params.action as string;

  try {
    let output: string;

    if (action === 'encode') {
      switch (encoding) {
        case 'base64':
          output = Buffer.from(input).toString('base64');
          break;
        case 'url':
          output = encodeURIComponent(input);
          break;
        case 'html':
          output = input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
          break;
        case 'hex':
          output = Buffer.from(input).toString('hex');
          break;
        default:
          return { content: { error: `Unknown encoding: ${encoding}` }, isError: true };
      }
    } else {
      switch (encoding) {
        case 'base64':
          output = Buffer.from(input, 'base64').toString('utf-8');
          break;
        case 'url':
          output = decodeURIComponent(input);
          break;
        case 'html':
          output = input
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'");
          break;
        case 'hex':
          output = Buffer.from(input, 'hex').toString('utf-8');
          break;
        default:
          return { content: { error: `Unknown encoding: ${encoding}` }, isError: true };
      }
    }

    return {
      content: {
        success: true,
        action,
        encoding,
        input: input.length > 50 ? input.substring(0, 50) + '...' : input,
        output,
      },
    };
  } catch (error) {
    return {
      content: { error: `${action} failed: ${error}` },
      isError: true,
    };
  }
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const codeAssistantPlugin = createPlugin()
  .meta({
    id: 'code-assistant',
    name: 'Code Assistant',
    version: '1.0.0',
    description: 'Code formatting, analysis, conversion, and utility tools',
    author: {
      name: 'OwnPilot',
    },
    capabilities: ['tools'],
    permissions: [],
    icon: '💻',
    pluginConfigSchema: [
      { name: 'defaultIndent', label: 'Default Indent', type: 'number', defaultValue: 2 },
      { name: 'maxLineLength', label: 'Max Line Length', type: 'number', defaultValue: 120 },
    ],
    defaultConfig: {
      defaultIndent: 2,
      maxLineLength: 120,
    },
  })
  .tools([
    { definition: formatCodeTool, executor: formatCodeExecutor },
    { definition: analyzeCodeTool, executor: analyzeCodeExecutor },
    { definition: convertCodeTool, executor: convertCodeExecutor },
    { definition: generateRegexTool, executor: generateRegexExecutor },
    { definition: minifyCodeTool, executor: minifyCodeExecutor },
    { definition: diffCodeTool, executor: diffCodeExecutor },
    { definition: hashTool, executor: hashExecutor },
    { definition: encodeDecodeTool, executor: encodeDecodeExecutor },
  ])
  .hooks({
    onLoad: async () => {
      console.log('[CodeAssistantPlugin] Loaded');
    },
  })
  .build();
