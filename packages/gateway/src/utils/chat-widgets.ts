const WIDGET_TAG_NAMES = [
  'widget',
  'metric',
  'metrics',
  'metric_grid',
  'stats',
  'table',
  'list',
  'checklist',
  'key_value',
  'key_values',
  'facts',
  'details',
  'properties',
  'card',
  'cards',
  'card_grid',
  'step',
  'steps',
  'plan',
  'callout',
  'note',
  'progress',
  'bar',
  'bar_chart',
  'timeline',
] as const;

const WIDGET_TAG_PATTERN = WIDGET_TAG_NAMES.join('|');
const WIDGET_TAG_REGEX = new RegExp(
  `<(${WIDGET_TAG_PATTERN})\\b[\\s\\S]*?(?:\\/>|>[\\s\\S]*?<\\/\\1>)`,
  'gi'
);

type WidgetName = (typeof WIDGET_TAG_NAMES)[number];

interface ParsedWidget {
  name: string;
  data: unknown;
}

const INVALID_WIDGET_TITLE = 'Widget could not be rendered';
const INVALID_WIDGET_BODY =
  'The data for this widget was incomplete or malformed, so it was hidden from the chat.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeAttributeValue(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readBalancedAttributeValue(
  source: string,
  startIndex: number
): { value: string; nextIndex: number } | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let index = startIndex;

  while (index < source.length) {
    const char = source[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
      stack.pop();
      if (stack.length === 0) {
        index += 1;
        return { value: source.slice(startIndex, index), nextIndex: index };
      }
    }

    index += 1;
  }

  return stack.length > 0 ? { value: source.slice(startIndex), nextIndex: index } : null;
}

function parseTagAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let index = 0;

  while (index < source.length) {
    while (/\s/.test(source[index] ?? '')) index += 1;

    const nameStart = index;
    while (/[a-zA-Z0-9_:.-]/.test(source[index] ?? '')) index += 1;
    const attrName = source.slice(nameStart, index).toLowerCase();
    if (!attrName) break;

    while (/\s/.test(source[index] ?? '')) index += 1;
    if (source[index] !== '=') continue;
    index += 1;
    while (/\s/.test(source[index] ?? '')) index += 1;

    const quote = source[index];
    if (quote !== '"' && quote !== "'") {
      const balanced =
        attrName === 'data' && (quote === '{' || quote === '[')
          ? readBalancedAttributeValue(source, index)
          : null;
      if (balanced) {
        attrs[attrName] = decodeAttributeValue(balanced.value);
        index = balanced.nextIndex;
        continue;
      }

      const valueStart = index;
      while (index < source.length && !/\s/.test(source[index] ?? '')) index += 1;
      attrs[attrName] = decodeAttributeValue(source.slice(valueStart, index));
      continue;
    }
    index += 1;

    let value = '';
    if (attrName === 'data' && quote === "'" && /^[\s]*[\[{]/.test(source.slice(index))) {
      const closingQuote = source.lastIndexOf(quote);
      if (closingQuote >= index) {
        value = source.slice(index, closingQuote);
        index = closingQuote;
      }
    }

    while (index < source.length) {
      const char = source[index]!;
      const next = source[index + 1];
      if (char === '\\' && next === quote) {
        value += char + next;
        index += 2;
        continue;
      }
      if (char === quote) break;
      value += char;
      index += 1;
    }

    attrs[attrName] = decodeAttributeValue(value);
    if (source[index] === quote) index += 1;
  }

  return attrs;
}

function parseWidgetData(value: string): unknown {
  const candidates = expandWidgetDataCandidates(value);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'string' && /^[\s[{]/.test(parsed)) {
        return JSON.parse(parsed);
      }
      return parsed;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('Invalid widget data');
}

function expandWidgetDataCandidates(value: string): string[] {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
  return Array.from(
    new Set([
      value,
      normalized,
      repairJsonLikeWidgetData(value),
      repairJsonLikeWidgetData(normalized),
    ])
  ).filter(Boolean);
}

function repairJsonLikeWidgetData(value: string): string {
  let repaired = value.trim();
  if (!repaired) return repaired;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of repaired) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
      stack.pop();
    }
  }

  if (escaped) repaired = repaired.slice(0, -1);
  if (inString) repaired += '"';

  while (stack.length > 0) {
    repaired = repaired.replace(/,\s*$/, '');
    repaired += stack.pop();
  }

  return repaired.replace(/,\s*([}\]])/g, '$1');
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
}

function recoverStringField(source: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const closed = source.match(
      new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`)
    )?.[1];
    if (closed) return decodeJsonString(closed);

    const partial = source.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*)$`))?.[1];
    if (partial) return decodeJsonString(partial.replace(/[,\]}]\s*$/, ''));
  }

  return undefined;
}

function recoverStringArray(source: string, key: string): string[] {
  const start = source.search(new RegExp(`"${key}"\\s*:\\s*\\[`));
  if (start === -1) return [];

  const afterKey = source.slice(start);
  const arrayStart = afterKey.indexOf('[');
  if (arrayStart === -1) return [];

  const arrayEnd = afterKey.indexOf(']', arrayStart + 1);
  const arrayBody =
    arrayEnd === -1 ? afterKey.slice(arrayStart + 1) : afterKey.slice(arrayStart + 1, arrayEnd);
  return Array.from(arrayBody.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)).map((match) =>
    decodeJsonString(match[1] ?? '')
  );
}

function recoverTableData(value: string): unknown {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const headers = recoverStringArray(normalized, 'headers');
  if (headers.length === 0) headers.push(...recoverStringArray(normalized, 'columns'));
  const rowsSourceStart = normalized.search(/"rows"\s*:\s*\[/);
  const rowsSource = rowsSourceStart === -1 ? normalized : normalized.slice(rowsSourceStart);

  const rows = Array.from(rowsSource.matchAll(/\[([^\[\]]*"[^\[\]]*")\s*\]/g))
    .map((match) =>
      Array.from((match[1] ?? '').matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)).map((cell) =>
        decodeJsonString(cell[1] ?? '')
      )
    )
    .filter((row) => row.length >= Math.max(1, Math.min(headers.length || 1, 2)));

  if (headers.length > 0 && rows.length > 0) return { headers, rows };

  const objectRows = Array.from(rowsSource.split('{').slice(1))
    .map((chunk) => {
      const itemSource = chunk.split('}')[0] ?? chunk;
      const row: Record<string, string> = {};
      for (const pair of itemSource.matchAll(
        /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g
      )) {
        const key = decodeJsonString(pair[1] ?? '');
        if (key === 'headers' || key === 'columns' || key === 'rows') continue;
        row[key] = decodeJsonString(pair[2] ?? '');
      }
      for (const header of headers) {
        row[header] ??= recoverStringField(itemSource, [header]) ?? '';
      }
      return row;
    })
    .filter((row) => Object.keys(row).length > 0);

  if (objectRows.length > 0) {
    const recoveredHeaders =
      headers.length > 0
        ? headers
        : Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));
    return { headers: recoveredHeaders, rows: objectRows };
  }

  return invalidWidgetData();
}

function recoverListData(value: string, name: string): unknown {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const title = recoverStringField(normalized, ['title']);
  const collectionStart = normalized.search(/"(?:items|entries|facts|cards|steps)"\s*:\s*\[/);
  const collectionSource = collectionStart === -1 ? normalized : normalized.slice(collectionStart);
  const isKeyValue =
    name === 'key_value' ||
    name === 'key_values' ||
    name === 'facts' ||
    name === 'details' ||
    name === 'properties';
  const items: Array<Record<string, string | undefined>> = [];

  for (const chunk of collectionSource.split('{').slice(1)) {
    const itemSource = `{${chunk}`;
    if (isKeyValue) {
      const key = recoverStringField(itemSource, ['key', 'label', 'name', 'title']);
      const value = recoverStringField(itemSource, [
        'value',
        'detail',
        'description',
        'body',
        'text',
      ]);
      if (key || value) items.push({ key, value });
      continue;
    }

    const itemTitle = recoverStringField(itemSource, ['title', 'label', 'name', 'key']);
    const detail = recoverStringField(itemSource, [
      'detail',
      'description',
      'body',
      'text',
      'value',
    ]);
    if (itemTitle || detail) items.push({ title: itemTitle, detail });
  }

  if (items.length > 0) return title ? { title, items } : { items };
  return invalidWidgetData();
}

function invalidWidgetData(): Record<string, string> {
  return {
    title: INVALID_WIDGET_TITLE,
    body: INVALID_WIDGET_BODY,
    tone: 'warning',
  };
}

function recoverGenericCalloutData(value: string): Record<string, string> | null {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const title = recoverStringField(normalized, ['title', 'heading', 'label', 'name']);
  const body = recoverStringField(normalized, [
    'body',
    'detail',
    'description',
    'text',
    'message',
    'summary',
    'value',
  ]);

  if (title || body) {
    return {
      title: title ?? 'Recovered widget content',
      body: body ?? title ?? '',
      tone: 'info',
    };
  }

  const ignoredKeys = new Set(['headers', 'columns', 'rows', 'items', 'entries', 'data']);
  const extracted = Array.from(
    normalized.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)
  )
    .map((match) => ({
      key: decodeJsonString(match[1] ?? ''),
      value: decodeJsonString(match[2] ?? ''),
    }))
    .filter((item) => item.key && item.value && !ignoredKeys.has(item.key))
    .slice(0, 5);

  if (extracted.length === 0) return null;

  return {
    title: 'Recovered widget content',
    body: extracted.map((item) => `${item.key}: ${item.value}`).join('\n'),
    tone: 'info',
  };
}

function isInvalidWidgetFallback(data: unknown): boolean {
  return isRecord(data) && data.title === INVALID_WIDGET_TITLE && data.body === INVALID_WIDGET_BODY;
}

function isCalloutLikeFallback(data: unknown): boolean {
  return isRecord(data) && typeof data.body === 'string' && !Array.isArray(data.items);
}

function firstArrayValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }
  return undefined;
}

function normalizeWidgetDataShape(name: string, data: unknown): unknown {
  if (!isRecord(data)) return data;
  if (isInvalidWidgetFallback(data)) return data;

  if (name === 'metric' || name === 'metrics' || name === 'metric_grid' || name === 'stats') {
    const items = firstArrayValue(data, ['items', 'metrics', 'stats', 'values']);
    return items && !Array.isArray(data.items) ? { ...data, items } : data;
  }

  if (name === 'list' || name === 'checklist') {
    const items = firstArrayValue(data, [
      'items',
      'entries',
      'list',
      'tasks',
      'todos',
      'recommendations',
      'suggestions',
    ]);
    return items && !Array.isArray(data.items) ? { ...data, items } : data;
  }

  if (name === 'table') {
    const rows = firstArrayValue(data, ['rows', 'items', 'entries', 'data']);
    const headers = firstArrayValue(data, ['headers', 'columns', 'fields']);
    const normalized = { ...data };
    if (rows && !Array.isArray(normalized.rows)) normalized.rows = rows;
    if (headers && !Array.isArray(normalized.headers)) normalized.headers = headers;
    return normalized;
  }

  if (
    name === 'key_value' ||
    name === 'key_values' ||
    name === 'facts' ||
    name === 'details' ||
    name === 'properties'
  ) {
    const items = firstArrayValue(data, ['items', 'entries', 'facts', 'properties', 'details']);
    if (items && !Array.isArray(data.items)) return { ...data, items };

    const reserved = new Set([
      'title',
      'tone',
      'status',
      'type',
      'items',
      'entries',
      'facts',
      'properties',
      'details',
    ]);
    const scalarItems = Object.entries(data)
      .filter(
        ([key, value]) =>
          !reserved.has(key) &&
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      )
      .map(([key, value]) => ({ key, value }));
    return scalarItems.length > 0 ? { title: data.title, items: scalarItems } : data;
  }

  if (name === 'card' || name === 'cards' || name === 'card_grid') {
    const items = firstArrayValue(data, ['items', 'cards', 'entries']);
    return items && !Array.isArray(data.items) ? { ...data, items } : data;
  }

  if (name === 'step' || name === 'steps' || name === 'plan') {
    const items = firstArrayValue(data, ['items', 'steps', 'plan', 'tasks']);
    return items && !Array.isArray(data.items) ? { ...data, items } : data;
  }

  if (name === 'bar' || name === 'bar_chart') {
    const items = firstArrayValue(data, ['items', 'bars', 'series', 'values']);
    return items && !Array.isArray(data.items) ? { ...data, items } : data;
  }

  if (name === 'timeline') {
    const items = firstArrayValue(data, ['items', 'events', 'entries']);
    return items && !Array.isArray(data.items) ? { ...data, items } : data;
  }

  if ((name === 'callout' || name === 'note') && data.type && !data.tone) {
    return { ...data, tone: data.type };
  }

  return data;
}

function recoverWidgetData(name: string, value: string): unknown {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");

  if (name === 'callout' || name === 'note') {
    const title = recoverStringField(normalized, ['title']);
    const body = recoverStringField(normalized, ['body', 'detail', 'description', 'text']);
    if (title || body) {
      return {
        title,
        body,
        tone: recoverStringField(normalized, ['type', 'tone', 'status']) ?? 'info',
      };
    }
  }

  if (name === 'table') return recoverTableData(value);
  if (
    name === 'list' ||
    name === 'checklist' ||
    name === 'key_value' ||
    name === 'key_values' ||
    name === 'facts' ||
    name === 'details' ||
    name === 'properties' ||
    name === 'card' ||
    name === 'cards' ||
    name === 'card_grid' ||
    name === 'step' ||
    name === 'steps' ||
    name === 'plan'
  ) {
    return recoverListData(value, name);
  }
  return recoverGenericCalloutData(value) ?? invalidWidgetData();
}

function parseWidgetTag(tag: string): ParsedWidget | null {
  const match = tag
    .trim()
    .match(/^<([a-zA-Z_][\w.-]*)(?:\s+([^>]*?))?\s*(?:\/>|>([\s\S]*?)<\/\1>)$/i);
  if (!match) return null;
  const tagName = match?.[1]?.toLowerCase() as WidgetName | undefined;
  if (!tagName || !WIDGET_TAG_NAMES.includes(tagName)) return null;

  const attrs = parseTagAttributes(match[2] ?? '');
  const name = tagName === 'widget' ? attrs.name?.trim() : tagName;
  if (!name) return null;

  const dataValue = attrs.data ?? match[3]?.trim();
  if (!dataValue) return { name, data: {} };

  try {
    return { name, data: normalizeWidgetDataShape(name, parseWidgetData(dataValue)) };
  } catch {
    const data = recoverWidgetData(name, dataValue);
    return {
      name: isInvalidWidgetFallback(data) || isCalloutLikeFallback(data) ? 'callout' : name,
      data: normalizeWidgetDataShape(name, data),
    };
  }
}

function encodeAttributeValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderWidgetTag(widget: ParsedWidget): string {
  const data = encodeAttributeValue(JSON.stringify(widget.data));
  return `<widget name="${encodeAttributeValue(widget.name)}" data="${data}" />`;
}

function normalizeChatWidgetsInText(content: string): string {
  WIDGET_TAG_REGEX.lastIndex = 0;
  return content.replace(WIDGET_TAG_REGEX, (tag) => {
    const widget = parseWidgetTag(tag);
    return widget ? renderWidgetTag(widget) : tag;
  });
}

export function normalizeChatWidgets(content: string): string {
  const codeBlockRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let result = '';
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    result += normalizeChatWidgetsInText(content.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  result += normalizeChatWidgetsInText(content.slice(lastIndex));
  return result;
}
