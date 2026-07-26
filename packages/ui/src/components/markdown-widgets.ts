/**
 * Markdown Widget Data Recovery
 *
 * Parses widget tags embedded within markdown content (e.g. <chart data={...} />).
 * The LLM often emits JSON-like data that is malformed (mismatched braces, unclosed
 * strings, CRLF-vs-LF mismatches). These helpers try multiple normalization strategies
 * to recover structured data from broken payloads.
 *
 * Exported as plain functions so they can be tested and reused outside of the
 * MarkdownContent component.
 */

// ── Attribute parsing ────────────────────────────────────────────────

export function decodeAttributeValue(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readBalancedAttributeValue(
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

export function parseTagAttributes(source: string): Record<string, string> {
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

// ── JSON repair ──────────────────────────────────────────────────────

export function repairJsonLikeWidgetData(value: string): string {
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

export function expandWidgetDataCandidates(value: string): string[] {
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

export function parseWidgetData(value: string): unknown {
  const candidates = expandWidgetDataCandidates(value);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'string' && /^[\s[{]/.test(parsed)) {
        return JSON.parse(parsed);
      }
      return parsed;
    } catch {
      // Try the next normalization.
    }
  }

  throw new Error('Invalid widget data');
}

// ── String/number field recovery ─────────────────────────────────────

export function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
}

export function recoverStringField(source: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const closed = source.match(
      new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`)
    )?.[1];
    if (closed) return decodeJsonString(closed);

    const partial = source.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*)$`))?.[1];
    if (partial) {
      return decodeJsonString(partial.replace(/[,\]}]\s*$/, ''));
    }
  }

  return undefined;
}

export function parseRecoveredNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replace(/%$/, '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function recoverNumberField(source: string, keys: string[]): number | undefined {
  for (const key of keys) {
    const direct = source.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`))?.[1];
    const parsedDirect = parseRecoveredNumber(direct);
    if (parsedDirect !== undefined) return parsedDirect;

    const quoted = recoverStringField(source, [key]);
    const parsedQuoted = parseRecoveredNumber(quoted);
    if (parsedQuoted !== undefined) return parsedQuoted;
  }

  return undefined;
}

// ── Object/collection recovery ───────────────────────────────────────

export function recoverScalarPairs(
  source: string,
  ignoredKeys = new Set<string>()
): Array<{ key: string; value: string | number | boolean }> {
  const pairs = new Map<string, string | number | boolean>();

  for (const match of source.matchAll(
    /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g
  )) {
    const key = decodeJsonString(match[1] ?? '');
    const value = decodeJsonString(match[2] ?? '');
    if (key && value && !ignoredKeys.has(key)) pairs.set(key, value);
  }

  for (const match of source.matchAll(
    /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*(-?\d+(?:\.\d+)?|true|false)\b/g
  )) {
    const key = decodeJsonString(match[1] ?? '');
    const rawValue = match[2] ?? '';
    if (!key || ignoredKeys.has(key) || pairs.has(key)) continue;
    pairs.set(key, rawValue === 'true' ? true : rawValue === 'false' ? false : Number(rawValue));
  }

  return Array.from(pairs, ([key, value]) => ({ key, value })).slice(0, 12);
}

export function compactRecoveredRecord(
  record: Record<string, string | number | boolean | undefined>
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== '')
  ) as Record<string, string | number | boolean>;
}

export function recoverObjectItems(
  source: string,
  collectionKeys: string[],
  mapItem: (itemSource: string) => Record<string, string | number | boolean>
): Array<Record<string, string | number | boolean>> {
  const collectionStart = source.search(
    new RegExp(`"(?:${collectionKeys.join('|')})"\\s*:\\s*\\[`)
  );
  const collectionSource = collectionStart === -1 ? source : source.slice(collectionStart);

  return collectionSource
    .split('{')
    .slice(1)
    .map((chunk) => mapItem(`{${chunk}`))
    .filter((item) => Object.keys(item).length > 0)
    .slice(0, 12);
}

// ── Widget-type-specific recovery ────────────────────────────────────

export function recoverStringArray(source: string, key: string): string[] {
  const start = source.search(new RegExp(`"${key}"\\s*:\\s*\\[`));
  if (start === -1) return [];

  const afterKey = source.slice(start);
  const arrayStart = afterKey.indexOf('[');
  if (arrayStart === -1) return [];

  const arrayBody = afterKey.slice(
    arrayStart + 1,
    afterKey.indexOf(']', arrayStart + 1) + 1 || undefined
  );
  return Array.from(arrayBody.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)).map((match) =>
    decodeJsonString(match[1] ?? '')
  );
}

export function recoverTableData(value: string): unknown {
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

  return { error: 'Invalid widget data' };
}

export function recoverMetricData(value: string): unknown {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const title = recoverStringField(normalized, ['title', 'heading']);
  const items = recoverObjectItems(normalized, ['items', 'metrics', 'stats', 'values'], (item) =>
    compactRecoveredRecord({
      label: recoverStringField(item, ['label', 'name', 'title', 'key']),
      value:
        recoverStringField(item, ['value', 'count', 'total', 'amount']) ??
        recoverNumberField(item, ['value', 'count', 'total', 'amount']),
      detail: recoverStringField(item, ['detail', 'description', 'change', 'status']),
      tone: recoverStringField(item, ['tone', 'status', 'type']),
    })
  );

  if (items.length > 0) return title ? { title, items } : { items };

  const scalarItems = recoverScalarPairs(
    normalized,
    new Set(['title', 'heading', 'tone', 'status', 'type', 'items', 'metrics', 'stats', 'values'])
  ).map((item) => ({ label: item.key, value: item.value }));

  if (scalarItems.length > 0) return title ? { title, items: scalarItems } : { items: scalarItems };
  return recoverGenericCalloutData(value);
}

export function recoverProgressData(value: string): unknown {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const title = recoverStringField(normalized, ['title', 'heading']);
  const label = recoverStringField(normalized, ['label', 'name']) ?? title;
  const recoveredValue = recoverNumberField(normalized, [
    'value',
    'percent',
    'progress',
    'current',
  ]);
  const max = recoverNumberField(normalized, ['max', 'total', 'target']);
  const body = recoverStringField(normalized, [
    'body',
    'detail',
    'description',
    'text',
    'message',
    'summary',
  ]);

  if (recoveredValue !== undefined || label || title) {
    return {
      ...(title ? { title } : {}),
      label: label ?? body ?? 'Progress',
      value: recoveredValue ?? 0,
      max: max ?? 100,
    };
  }

  return recoverGenericCalloutData(value);
}

export function recoverBarChartData(value: string): unknown {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const title = recoverStringField(normalized, ['title', 'heading']);
  const items = recoverObjectItems(normalized, ['items', 'bars', 'series', 'values'], (item) => {
    const numericValue = recoverNumberField(item, ['value', 'count', 'total', 'amount']);
    return compactRecoveredRecord({
      label: recoverStringField(item, ['label', 'name', 'title', 'key']),
      value: numericValue ?? 0,
      displayValue: recoverStringField(item, ['displayValue', 'display', 'value']),
    });
  });

  if (items.length > 0) return title ? { title, items } : { items };
  return recoverGenericCalloutData(value);
}

export function recoverTimelineData(value: string): unknown {
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const title = recoverStringField(normalized, ['title', 'heading']);
  const items = recoverObjectItems(normalized, ['items', 'events', 'entries'], (item) =>
    compactRecoveredRecord({
      time: recoverStringField(item, ['time', 'date', 'when']),
      label: recoverStringField(item, ['label', 'title', 'name']),
      detail: recoverStringField(item, ['detail', 'description', 'body', 'text']),
      tone: recoverStringField(item, ['tone', 'status', 'type']),
    })
  );

  if (items.length > 0) return title ? { title, items } : { items };
  return recoverGenericCalloutData(value);
}

export function recoverListData(value: string, name: string): unknown {
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
  return { error: 'Invalid widget data' };
}

export function recoverGenericCalloutData(value: string): unknown {
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

  if (extracted.length === 0) return { error: 'Invalid widget data' };

  return {
    title: 'Recovered widget content',
    body: extracted.map((item) => `${item.key}: ${item.value}`).join('\n'),
    tone: 'info',
  };
}

// ── Data shape normalization ─────────────────────────────────────────

export function isInvalidWidgetFallback(data: unknown): boolean {
  return isRecord(data) && data.error === 'Invalid widget data';
}

export function isCalloutLikeFallback(data: unknown): boolean {
  return isRecord(data) && typeof data.body === 'string' && !Array.isArray(data.items);
}

function firstArrayValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }
  return undefined;
}

export function canonicalWidgetName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function normalizeWidgetDataShape(name: string, data: unknown): unknown {
  name = canonicalWidgetName(name);
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

    const singleLabel = data.key ?? data.label ?? data.name;
    const singleValue = data.value ?? data.text ?? data.detail ?? data.description;
    if (
      (typeof singleLabel === 'string' || typeof singleLabel === 'number') &&
      (typeof singleValue === 'string' ||
        typeof singleValue === 'number' ||
        typeof singleValue === 'boolean')
    ) {
      return { title: data.title, items: [{ key: singleLabel, value: singleValue }] };
    }
  }

  return data;
}

// ── Widget data dispatcher ──────────────────────────────────────────

/**
 * Route a raw widget data string to the correct recovery function based on widget name.
 * Used by MarkdownContent to parse widget data from markdown widget tags.
 */
export function recoverWidgetData(name: string, value: string): unknown {
  name = canonicalWidgetName(name);
  const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");

  if (name === 'callout' || name === 'note') {
    const title = recoverStringField(normalized, ['title']);
    const body = recoverStringField(normalized, ['body', 'detail', 'text']);
    if (title || body) {
      return {
        title,
        body,
        tone: normalized.match(/"(?:type|tone|status)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/)?.[1],
      };
    }
  }

  if (name === 'table') return recoverTableData(value);
  if (name === 'metric' || name === 'metrics' || name === 'metric_grid' || name === 'stats') {
    return recoverMetricData(value);
  }
  if (name === 'progress') return recoverProgressData(value);
  if (name === 'bar' || name === 'bar_chart') return recoverBarChartData(value);
  if (name === 'timeline') return recoverTimelineData(value);
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

  return recoverGenericCalloutData(value);
}
