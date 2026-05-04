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
