/**
 * Tool Templates
 *
 * Pre-built tool template definitions for the custom tools system.
 * Extracted from custom-tools.ts to keep the route file focused on handlers.
 */

// =============================================================================
// Types
// =============================================================================

export interface ToolTemplate {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  permissions: string[];
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  code: string;
  requiredApiKeys?: Array<{ name: string; displayName?: string; description?: string; category?: string; docsUrl?: string }>;
}

// =============================================================================
// Templates
// =============================================================================

export const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: 'api_fetcher',
    name: 'fetch_api_data',
    displayName: 'API Data Fetcher',
    description: 'Fetch data from a REST API endpoint with error handling',
    category: 'Network',
    permissions: ['network'],
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'API endpoint URL' },
        method: { type: 'string', description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        headers: { type: 'object', description: 'Optional request headers' },
        body: { type: 'object', description: 'Optional request body (for POST/PUT)' },
      },
      required: ['url'],
    },
    code: `// API Data Fetcher - Secure REST API client
const { url, method = 'GET', headers = {}, body: requestBody } = args;

try {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (requestBody && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(requestBody);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    return { error: true, status: response.status, message: response.statusText };
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json')
    ? await response.json()
    : await response.text();

  return { success: true, status: response.status, data };
} catch (error) {
  return { error: true, message: String(error) };
}`,
  },
  {
    id: 'data_transformer',
    name: 'transform_data',
    displayName: 'Data Transformer',
    description: 'Transform and reshape JSON data using mapping rules',
    category: 'Data',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        data: { type: 'object', description: 'Input data to transform' },
        mappings: {
          type: 'array',
          description: 'Array of {from, to, transform?} mapping rules',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Source path (dot notation)' },
              to: { type: 'string', description: 'Target path' },
              transform: { type: 'string', description: 'Optional: uppercase, lowercase, trim, number, boolean' },
            },
          },
        },
      },
      required: ['data', 'mappings'],
    },
    code: `// Data Transformer - Reshape JSON with mapping rules
const { data, mappings } = args;
const result = {};

for (const { from, to, transform } of mappings) {
  let value = utils.getPath(data, from);

  if (transform && value !== undefined) {
    switch (transform) {
      case 'uppercase': value = String(value).toUpperCase(); break;
      case 'lowercase': value = String(value).toLowerCase(); break;
      case 'trim': value = String(value).trim(); break;
      case 'number': value = Number(value); break;
      case 'boolean': value = Boolean(value); break;
    }
  }

  // Set nested path
  const parts = to.split('.');
  let current = result;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

return result;`,
  },
  {
    id: 'text_formatter',
    name: 'format_text',
    displayName: 'Text Formatter',
    description: 'Format and manipulate text with various operations',
    category: 'Text',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Input text' },
        operations: {
          type: 'array',
          description: 'Operations to apply in order: trim, uppercase, lowercase, slugify, camelCase, snakeCase, truncate:N, replace:old:new, prefix:text, suffix:text, lines, words, sentences',
          items: { type: 'string' },
        },
      },
      required: ['text', 'operations'],
    },
    code: `// Text Formatter - Chain text operations
const { text, operations } = args;
let result = text;

for (const op of operations) {
  const [name, ...opArgs] = op.split(':');

  switch (name) {
    case 'trim': result = result.trim(); break;
    case 'uppercase': result = result.toUpperCase(); break;
    case 'lowercase': result = result.toLowerCase(); break;
    case 'slugify': result = utils.slugify(result); break;
    case 'camelCase': result = utils.camelCase(result); break;
    case 'snakeCase': result = utils.snakeCase(result); break;
    case 'titleCase': result = utils.titleCase(result); break;
    case 'truncate': result = utils.truncate(result, parseInt(opArgs[0] || '100')); break;
    case 'replace': result = result.replaceAll(opArgs[0] || '', opArgs[1] || ''); break;
    case 'prefix': result = (opArgs[0] || '') + result; break;
    case 'suffix': result = result + (opArgs[0] || ''); break;
    case 'lines': return result.split('\\n'); // returns array
    case 'words': return result.trim().split(/\\s+/); // returns array
    case 'sentences': return result.split(/[.!?]+/).filter(s => s.trim()); // returns array
    case 'reverse': result = result.split('').reverse().join(''); break;
    case 'removeDiacritics': result = utils.removeDiacritics(result); break;
    default: break;
  }
}

return result;`,
  },
  {
    id: 'calculator',
    name: 'calculate',
    displayName: 'Calculator',
    description: 'Perform mathematical calculations and statistics',
    category: 'Math',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Operation: add, subtract, multiply, divide, power, sqrt, percentage, average, sum, min, max, median, round',
          enum: ['add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'percentage', 'average', 'sum', 'min', 'max', 'median', 'round'],
        },
        values: { type: 'array', description: 'Array of numbers to operate on', items: { type: 'number' } },
        decimals: { type: 'number', description: 'Decimal places for rounding (default: 2)' },
      },
      required: ['operation', 'values'],
    },
    code: `// Calculator - Math operations and statistics
const { operation, values, decimals = 2 } = args;

if (!values || values.length === 0) {
  return { error: 'No values provided' };
}

const round = (n) => utils.round(n, decimals);
const sorted = [...values].sort((a, b) => a - b);

switch (operation) {
  case 'add': return { result: round(utils.sum(values)) };
  case 'subtract': return { result: round(values.reduce((a, b) => a - b)) };
  case 'multiply': return { result: round(values.reduce((a, b) => a * b)) };
  case 'divide': {
    if (values.slice(1).some(v => v === 0)) return { error: 'Division by zero' };
    return { result: round(values.reduce((a, b) => a / b)) };
  }
  case 'power': return { result: round(Math.pow(values[0], values[1] || 2)) };
  case 'sqrt': return { result: round(Math.sqrt(values[0])) };
  case 'percentage': return { result: round((values[0] / values[1]) * 100) + '%' };
  case 'average': return { result: round(utils.avg(values)) };
  case 'sum': return { result: round(utils.sum(values)) };
  case 'min': return { result: Math.min(...values) };
  case 'max': return { result: Math.max(...values) };
  case 'median': {
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { result: round(median) };
  }
  case 'round': return { result: round(values[0]) };
  default: return { error: 'Unknown operation: ' + operation };
}`,
  },
  {
    id: 'api_with_key',
    name: 'fetch_with_api_key',
    displayName: 'API Fetcher with Key',
    description: 'Fetch from an API that requires an API key from Config Center',
    category: 'Network',
    permissions: ['network'],
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Config Center service name for the API key' },
        url: { type: 'string', description: 'API endpoint URL' },
        queryParams: { type: 'object', description: 'URL query parameters' },
        authHeader: { type: 'string', description: 'Auth header name (default: Authorization)' },
        authPrefix: { type: 'string', description: 'Auth value prefix (default: Bearer)' },
      },
      required: ['service', 'url'],
    },
    requiredApiKeys: [{ name: 'custom_api', displayName: 'Custom API', description: 'API key for the target service' }],
    code: `// API Fetcher with Config Center key
const { service, url, queryParams = {}, authHeader = 'Authorization', authPrefix = 'Bearer' } = args;

const apiKey = utils.getApiKey(service);
if (!apiKey) {
  return { error: true, message: 'API key not configured. Go to Config Center to add the "' + service + '" API key.' };
}

try {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(queryParams)) {
    params.set(k, String(v));
  }
  const fullUrl = Object.keys(queryParams).length > 0
    ? url + '?' + params.toString()
    : url;

  const response = await fetch(fullUrl, {
    headers: {
      [authHeader]: authPrefix ? authPrefix + ' ' + apiKey : apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    return { error: true, status: response.status, message: response.statusText };
  }

  const data = await response.json();
  return { success: true, data };
} catch (error) {
  return { error: true, message: String(error) };
}`,
  },
  {
    id: 'json_schema_validator',
    name: 'validate_json_schema',
    displayName: 'JSON Schema Validator',
    description: 'Validate data against a JSON-like schema definition',
    category: 'Data',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        data: { type: 'object', description: 'Data to validate' },
        schema: {
          type: 'object',
          description: 'Schema: { fieldName: { type: "string|number|boolean|array|object", required?: true, min?: N, max?: N, pattern?: "regex", enum?: [] } }',
        },
      },
      required: ['data', 'schema'],
    },
    code: `// JSON Schema Validator - validate data against schema rules
const { data, schema } = args;
const errors = [];

for (const [field, rules] of Object.entries(schema)) {
  const value = data[field];
  const r = rules;

  if (r.required && (value === undefined || value === null)) {
    errors.push(field + ' is required');
    continue;
  }
  if (value === undefined || value === null) continue;

  if (r.type && typeof value !== r.type && !(r.type === 'array' && Array.isArray(value))) {
    errors.push(field + ' must be type ' + r.type + ', got ' + typeof value);
  }
  if (r.min !== undefined && typeof value === 'number' && value < r.min) {
    errors.push(field + ' must be >= ' + r.min);
  }
  if (r.max !== undefined && typeof value === 'number' && value > r.max) {
    errors.push(field + ' must be <= ' + r.max);
  }
  if (r.min !== undefined && typeof value === 'string' && value.length < r.min) {
    errors.push(field + ' must be at least ' + r.min + ' characters');
  }
  if (r.max !== undefined && typeof value === 'string' && value.length > r.max) {
    errors.push(field + ' must be at most ' + r.max + ' characters');
  }
  if (r.pattern && typeof value === 'string' && !new RegExp(r.pattern).test(value)) {
    errors.push(field + ' must match pattern ' + r.pattern);
  }
  if (r.enum && !r.enum.includes(value)) {
    errors.push(field + ' must be one of: ' + r.enum.join(', '));
  }
}

return { valid: errors.length === 0, errors, fieldCount: Object.keys(schema).length };`,
  },
  {
    id: 'cron_parser',
    name: 'parse_cron',
    displayName: 'Cron Expression Parser',
    description: 'Parse and describe cron expressions in human-readable format',
    category: 'Utilities',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Cron expression (5 fields: min hour dom month dow)' },
      },
      required: ['expression'],
    },
    code: `// Cron Expression Parser
const { expression } = args;
const parts = expression.trim().split(/\\s+/);
if (parts.length !== 5) return { error: 'Cron expression must have 5 fields: minute hour day-of-month month day-of-week' };

const [minute, hour, dom, month, dow] = parts;
const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

function describeField(val, unit, names) {
  if (val === '*') return 'every ' + unit;
  if (val.includes('/')) { const [, step] = val.split('/'); return 'every ' + step + ' ' + unit + 's'; }
  if (val.includes(',')) return unit + 's ' + val.split(',').map(v => names ? names[parseInt(v)] || v : v).join(', ');
  if (val.includes('-')) { const [s, e] = val.split('-'); return unit + 's ' + (names ? (names[parseInt(s)] || s) : s) + ' through ' + (names ? (names[parseInt(e)] || e) : e); }
  return unit + ' ' + (names ? names[parseInt(val)] || val : val);
}

return {
  expression,
  fields: { minute, hour, dayOfMonth: dom, month, dayOfWeek: dow },
  description: [
    describeField(minute, 'minute'),
    describeField(hour, 'hour'),
    describeField(dom, 'day'),
    describeField(month, 'month', monthNames),
    describeField(dow, 'weekday', dayNames),
  ].join(', '),
};`,
  },
  {
    id: 'markdown_to_html',
    name: 'markdown_to_html',
    displayName: 'Markdown to HTML',
    description: 'Convert basic Markdown text to HTML',
    category: 'Text',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Markdown text to convert' },
      },
      required: ['markdown'],
    },
    code: `// Markdown to HTML converter (basic subset)
const { markdown } = args;
let html = markdown
  // Headers
  .replace(/^### (.+)$/gm, '<h3>$1</h3>')
  .replace(/^## (.+)$/gm, '<h2>$1</h2>')
  .replace(/^# (.+)$/gm, '<h1>$1</h1>')
  // Bold and italic
  .replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>')
  .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
  .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
  // Code blocks
  .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
  .replace(/\`(.+?)\`/g, '<code>$1</code>')
  // Links and images
  .replace(/!\\[(.+?)\\]\\((.+?)\\)/g, '<img alt="$1" src="$2" />')
  .replace(/\\[(.+?)\\]\\((.+?)\\)/g, '<a href="$2">$1</a>')
  // Lists
  .replace(/^- (.+)$/gm, '<li>$1</li>')
  .replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>')
  // Horizontal rule
  .replace(/^---$/gm, '<hr />')
  // Blockquote
  .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
  // Paragraphs (double newlines)
  .replace(/\\n\\n/g, '</p><p>');

html = '<p>' + html + '</p>';
// Clean up empty paragraphs
html = html.replace(/<p><\\/p>/g, '').replace(/<p>(<h[1-6]>)/g, '$1').replace(/(<\\/h[1-6]>)<\\/p>/g, '$1');

return { html, charCount: html.length };`,
  },
  {
    id: 'url_parser',
    name: 'parse_url',
    displayName: 'URL Parser & Builder',
    description: 'Parse URLs into components or build URLs from parts',
    category: 'Utilities',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to parse (for parse mode)' },
        mode: { type: 'string', description: 'parse or build', enum: ['parse', 'build'] },
        parts: { type: 'object', description: 'URL parts for build mode: {protocol, hostname, port, pathname, search, hash}' },
      },
      required: ['mode'],
    },
    code: `// URL Parser & Builder
const { url, mode, parts } = args;

if (mode === 'parse') {
  if (!url) return { error: 'url is required for parse mode' };
  try {
    const u = new URL(url);
    const params = {};
    u.searchParams.forEach((v, k) => { params[k] = v; });
    return {
      href: u.href, protocol: u.protocol, hostname: u.hostname,
      port: u.port, pathname: u.pathname, search: u.search,
      hash: u.hash, origin: u.origin, params,
    };
  } catch (e) {
    return { error: 'Invalid URL: ' + String(e) };
  }
}

if (mode === 'build') {
  if (!parts) return { error: 'parts is required for build mode' };
  const p = parts;
  let result = (p.protocol || 'https:') + '//' + (p.hostname || 'example.com');
  if (p.port) result += ':' + p.port;
  result += (p.pathname || '/');
  if (p.search) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(p.search)) params.set(k, String(v));
    result += '?' + params.toString();
  }
  if (p.hash) result += '#' + p.hash;
  return { url: result };
}

return { error: 'mode must be "parse" or "build"' };`,
  },
  {
    id: 'string_template',
    name: 'render_template',
    displayName: 'String Template Engine',
    description: 'Simple Mustache-like templating: replace {{key}} with values',
    category: 'Text',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template string with {{key}} placeholders' },
        data: { type: 'object', description: 'Key-value pairs for replacement' },
      },
      required: ['template', 'data'],
    },
    code: `// String Template Engine - {{key}} replacement
const { template, data } = args;

let result = template;
const used = [];
const missing = [];

// Replace all {{key}} and {{key.nested}} patterns
result = result.replace(/\\{\\{([^}]+)\\}\\}/g, (match, key) => {
  const trimmed = key.trim();
  const value = utils.getPath(data, trimmed);
  if (value !== undefined) {
    used.push(trimmed);
    return String(value);
  }
  missing.push(trimmed);
  return match; // Leave unreplaced
});

return { rendered: result, usedKeys: used, missingKeys: missing };`,
  },
  {
    id: 'data_aggregator',
    name: 'aggregate_data',
    displayName: 'Data Aggregator',
    description: 'Group, count, sum, and average operations on JSON arrays',
    category: 'Data',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array of objects to aggregate', items: { type: 'object' } },
        groupBy: { type: 'string', description: 'Field to group by' },
        operations: {
          type: 'array', description: 'Operations: [{field: "amount", op: "sum|avg|min|max|count"}]',
          items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string' } } },
        },
      },
      required: ['data', 'operations'],
    },
    code: `// Data Aggregator - group, count, sum, avg on arrays
const { data, groupBy: groupField, operations } = args;

function aggregate(items, ops) {
  const result = { count: items.length };
  for (const { field, op } of ops) {
    const values = items.map(i => parseFloat(i[field])).filter(n => !isNaN(n));
    switch (op) {
      case 'sum': result[field + '_sum'] = utils.sum(values); break;
      case 'avg': result[field + '_avg'] = utils.avg(values); break;
      case 'min': result[field + '_min'] = values.length ? Math.min(...values) : null; break;
      case 'max': result[field + '_max'] = values.length ? Math.max(...values) : null; break;
      case 'count': result[field + '_count'] = values.length; break;
    }
  }
  return result;
}

if (!groupField) {
  return { total: aggregate(data, operations) };
}

const groups = {};
for (const item of data) {
  const key = String(item[groupField] ?? 'undefined');
  if (!groups[key]) groups[key] = [];
  groups[key].push(item);
}

const result = {};
for (const [key, items] of Object.entries(groups)) {
  result[key] = aggregate(items, operations);
}

return { groups: result, groupCount: Object.keys(result).length };`,
  },
  {
    id: 'regex_tester',
    name: 'test_regex',
    displayName: 'Regex Tester',
    description: 'Test regex patterns against strings with detailed match information',
    category: 'Text',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression pattern' },
        flags: { type: 'string', description: 'Regex flags (e.g., "gi")' },
        text: { type: 'string', description: 'Text to test against' },
      },
      required: ['pattern', 'text'],
    },
    code: `// Regex Tester - test patterns with match details
const { pattern, flags = 'g', text } = args;

try {
  const regex = new RegExp(pattern, flags);
  const matches = [];
  let match;

  if (flags.includes('g')) {
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        match: match[0],
        index: match.index,
        groups: match.slice(1),
        namedGroups: match.groups || {},
      });
      if (matches.length > 100) break; // Safety limit
    }
  } else {
    match = regex.exec(text);
    if (match) {
      matches.push({
        match: match[0],
        index: match.index,
        groups: match.slice(1),
        namedGroups: match.groups || {},
      });
    }
  }

  return {
    matches: matches.length > 0,
    matchCount: matches.length,
    details: matches,
    pattern,
    flags,
  };
} catch (e) {
  return { error: 'Invalid regex: ' + String(e) };
}`,
  },
  {
    id: 'date_range',
    name: 'generate_date_range',
    displayName: 'Date Range Generator',
    description: 'Generate a range of dates for scheduling and planning',
    category: 'Utilities',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Start date (ISO string or "now")' },
        end: { type: 'string', description: 'End date (ISO string)' },
        step: { type: 'string', description: 'Step unit: days, weeks, months', enum: ['days', 'weeks', 'months'] },
        stepSize: { type: 'number', description: 'Step size (default: 1)' },
        format: { type: 'string', description: 'Output format: iso, date, unix', enum: ['iso', 'date', 'unix'] },
      },
      required: ['start', 'end'],
    },
    code: `// Date Range Generator
const { start, end, step = 'days', stepSize = 1, format = 'iso' } = args;

const startDate = start === 'now' ? new Date() : new Date(start);
const endDate = new Date(end);
const dates = [];

if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
  return { error: 'Invalid date format' };
}
if (startDate > endDate) return { error: 'Start date must be before end date' };

let current = new Date(startDate);
while (current <= endDate && dates.length < 1000) {
  switch (format) {
    case 'date': dates.push(current.toISOString().split('T')[0]); break;
    case 'unix': dates.push(current.getTime()); break;
    default: dates.push(current.toISOString()); break;
  }
  switch (step) {
    case 'weeks': current = new Date(current.getTime() + stepSize * 7 * 86400000); break;
    case 'months': current = new Date(current.setMonth(current.getMonth() + stepSize)); break;
    default: current = new Date(current.getTime() + stepSize * 86400000); break;
  }
}

return { dates, count: dates.length, start: startDate.toISOString(), end: endDate.toISOString() };`,
  },
  {
    id: 'hash_checksum',
    name: 'compute_hash',
    displayName: 'Hash & Checksum',
    description: 'Compute various hash digests for data integrity verification',
    category: 'Utilities',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Data to hash' },
        algorithms: {
          type: 'array', description: 'Hash algorithms (default: all)', items: { type: 'string' },
        },
      },
      required: ['data'],
    },
    code: `// Hash & Checksum - compute multiple hashes
const { data, algorithms } = args;
const algos = algorithms || ['md5', 'sha1', 'sha256', 'sha512'];
const hashes = {};

for (const algo of algos) {
  try {
    hashes[algo] = utils.hash(data, algo);
  } catch (e) {
    hashes[algo] = 'error: ' + String(e);
  }
}

return {
  hashes,
  dataLength: data.length,
  algorithms: Object.keys(hashes),
};`,
  },
  {
    id: 'env_config',
    name: 'get_tool_config',
    displayName: 'Environment-Aware Config',
    description: 'Template for Config Center integrated tools — reads API keys and service configs',
    category: 'Config',
    permissions: ['network'],
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Config Center service name' },
        field: { type: 'string', description: 'Specific field to retrieve (optional)' },
        action: { type: 'string', description: 'Action: get_key, get_config, list_entries', enum: ['get_key', 'get_config', 'list_entries'] },
      },
      required: ['service', 'action'],
    },
    requiredApiKeys: [{ name: 'custom_service', displayName: 'Custom Service', description: 'API key for the target service' }],
    code: `// Environment-Aware Config - Config Center integration
const { service, field, action } = args;

switch (action) {
  case 'get_key': {
    const key = utils.getApiKey(service);
    if (!key) return { error: true, message: 'No API key configured for "' + service + '". Please add it in Config Center.' };
    return { configured: true, service, keyPreview: key.slice(0, 4) + '...' + key.slice(-4) };
  }
  case 'get_config': {
    const entry = utils.getConfigEntry(service);
    if (!entry) return { error: true, message: 'No config found for "' + service + '"' };
    if (field) {
      const value = utils.getFieldValue(service, field);
      return { service, field, value: value !== undefined ? value : null };
    }
    return { service, config: entry };
  }
  case 'list_entries': {
    const entries = utils.getConfigEntries(service);
    return { service, entries: entries.map(e => ({ label: e.label, fields: Object.keys(e.data || {}) })), count: entries.length };
  }
  default:
    return { error: 'Unknown action: ' + action };
}`,
  },
  {
    id: 'csv_processor',
    name: 'process_csv',
    displayName: 'CSV Processor',
    description: 'Parse, filter, sort, and aggregate CSV data',
    category: 'Data',
    permissions: [],
    parameters: {
      type: 'object',
      properties: {
        csv: { type: 'string', description: 'CSV string data' },
        delimiter: { type: 'string', description: 'Column delimiter (default: comma)' },
        filter: { type: 'object', description: 'Filter: {column: "name", operator: "eq|neq|gt|lt|contains", value: "..."}' },
        sortBy: { type: 'string', description: 'Column name to sort by' },
        sortOrder: { type: 'string', description: 'asc or desc', enum: ['asc', 'desc'] },
        columns: { type: 'array', description: 'Columns to include in output', items: { type: 'string' } },
        limit: { type: 'number', description: 'Max rows to return' },
      },
      required: ['csv'],
    },
    code: `// CSV Processor - Parse, filter, sort, aggregate
const { csv, delimiter = ',', filter, sortBy, sortOrder = 'asc', columns, limit } = args;

let rows = utils.parseCsv(csv, delimiter);
if (rows.length === 0) return { rows: [], count: 0 };

// Filter
if (filter) {
  const { column, operator, value } = filter;
  rows = rows.filter(row => {
    const cellVal = row[column] || '';
    switch (operator) {
      case 'eq': return cellVal === String(value);
      case 'neq': return cellVal !== String(value);
      case 'gt': return parseFloat(cellVal) > parseFloat(value);
      case 'lt': return parseFloat(cellVal) < parseFloat(value);
      case 'contains': return cellVal.toLowerCase().includes(String(value).toLowerCase());
      default: return true;
    }
  });
}

// Sort
if (sortBy) {
  rows.sort((a, b) => {
    const va = a[sortBy] || '', vb = b[sortBy] || '';
    const numA = parseFloat(va), numB = parseFloat(vb);
    const cmp = (!isNaN(numA) && !isNaN(numB)) ? numA - numB : va.localeCompare(vb);
    return sortOrder === 'desc' ? -cmp : cmp;
  });
}

// Select columns
if (columns && columns.length > 0) {
  rows = rows.map(row => {
    const filtered = {};
    for (const col of columns) { filtered[col] = row[col]; }
    return filtered;
  });
}

// Limit
if (limit && limit > 0) rows = rows.slice(0, limit);

return { rows, count: rows.length, totalBeforeFilter: rows.length };`,
  },
];
