export const CHAT_WIDGET_TAG_NAMES = [
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

const WIDGET_TAG_START_REGEX = new RegExp(`^<(${CHAT_WIDGET_TAG_NAMES.join('|')})\\b`, 'i');

export function hideIncompleteStreamingWidgets(content: string): string {
  let inCodeFence = false;
  let index = 0;
  let pendingWidgetStart = -1;
  const lowerContent = content.toLowerCase();

  while (index < content.length) {
    if (content.startsWith('```', index)) {
      inCodeFence = !inCodeFence;
      index += 3;
      continue;
    }

    if (!inCodeFence) {
      const tagStart = content.slice(index).match(WIDGET_TAG_START_REGEX);
      if (tagStart) {
        const tagName = tagStart[1]!.toLowerCase();
        const searchFrom = index + tagStart[0].length;
        const selfClosingAt = content.indexOf('/>', searchFrom);
        const closingTag = `</${tagName}>`;
        const closingAt = lowerContent.indexOf(closingTag, searchFrom);
        const completionStart =
          selfClosingAt === -1
            ? closingAt
            : closingAt === -1
              ? selfClosingAt
              : Math.min(selfClosingAt, closingAt);
        const completedAt =
          completionStart === -1
            ? -1
            : completionStart === closingAt
              ? closingAt + closingTag.length
              : selfClosingAt + 2;
        let nextWidgetAt = -1;

        for (const tagName of CHAT_WIDGET_TAG_NAMES) {
          const candidate = lowerContent.indexOf(`<${tagName}`, index + tagStart[0].length);
          if (candidate !== -1 && (nextWidgetAt === -1 || candidate < nextWidgetAt)) {
            nextWidgetAt = candidate;
          }
        }

        if (completedAt === -1 || (nextWidgetAt !== -1 && nextWidgetAt < completionStart)) {
          pendingWidgetStart = index;
          break;
        }

        index = completedAt;
        continue;
      }
    }

    index += 1;
  }

  if (pendingWidgetStart === -1) return content;
  return content.slice(0, pendingWidgetStart).trimEnd();
}

// Marker patterns (streaming-friendly, unambiguous)
const MARKER_WIDGET_REGEX = /<!--WIDGET#(\d+)#([\s\S]*?)<!--WIDGET#\1#END-->/g;
const MARKER_SUGGESTIONS_REGEX = /<!--SUGGESTIONS#START-->([\s\S]*?)<!--SUGGESTIONS#END-->/g;

export interface ParsedMarkerWidget {
  type: 'widget';
  id: number;
  name: string;
  data: unknown;
  markerText: string;
}

export interface ParsedMarkerSuggestion {
  type: 'suggestion';
  items: Array<{ title: string; detail: string }>;
  markerText: string;
}

const parseMarkerData = (inner: string): Array<{ title: string; detail: string }> => {
  try {
    const parsed = JSON.parse(inner);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        title: typeof item === 'string' ? item : (item.title ?? String(item)),
        detail: typeof item === 'object' ? (item.detail ?? item.description ?? '') : '',
      }));
    }
  } catch {
    /* fall through to line parsing */
  }
  return inner.split('\n').filter(Boolean).map((line) => {
    try {
      const obj = JSON.parse(line);
      return { title: obj.title ?? line, detail: obj.detail ?? obj.description ?? '' };
    } catch {
      return { title: line, detail: '' };
    }
  });
};

const parseMarkerWidgetData = (dataStr: string): unknown => {
  try {
    return JSON.parse(dataStr);
  } catch {
    return dataStr;
  }
};

/** Parse widget and suggestion markers — returns clean text and interactive elements */
export function parseMarkers(content: string): {
  widgets: ParsedMarkerWidget[];
  suggestions: ParsedMarkerSuggestion[];
} {
  const widgets: ParsedMarkerWidget[] = [];
  const suggestions: ParsedMarkerSuggestion[] = [];

  let match: RegExpExecArray | null;

  MARKER_WIDGET_REGEX.lastIndex = 0;
  while ((match = MARKER_WIDGET_REGEX.exec(content)) !== null) {
    const id = parseInt(match[1]!, 10);
    const inner = match[2]!;
    const sep = inner.indexOf('#');
    if (sep === -1) continue;
    const name = inner.slice(0, sep).trim();
    const dataStr = inner.slice(sep + 1);
    widgets.push({ type: 'widget', id, name, data: parseMarkerWidgetData(dataStr), markerText: match[0] });
  }

  MARKER_SUGGESTIONS_REGEX.lastIndex = 0;
  while ((match = MARKER_SUGGESTIONS_REGEX.exec(content)) !== null) {
    suggestions.push({ type: 'suggestion', items: parseMarkerData(match[1]!), markerText: match[0] });
  }

  return { widgets, suggestions };
}

/** Remove all marker tags — returns pure text */
export function stripMarkerTags(content: string): string {
  return content
    .replace(MARKER_WIDGET_REGEX, '')
    .replace(MARKER_SUGGESTIONS_REGEX, '')
    .trim();
}

export function stripChatInternalTags(content: string): string {
  return content
    .replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>\s*/gi, '')
    .replace(/<(?:think|thinking)>[\s\S]*$/gi, '')
    .replace(/<memories>[\s\S]*?<\/memories>\s*/gi, '')
    .replace(/<memories>[\s\S]*$/gi, '')
    .replace(/<suggestions>[\s\S]*(?:<\/suggestions>)?\s*$/gi, '')
    .trimEnd();
}

export function cleanStreamingChatContent(content: string): string {
  return hideIncompleteStreamingWidgets(stripChatInternalTags(content));
}
