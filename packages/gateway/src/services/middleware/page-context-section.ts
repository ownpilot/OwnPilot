import { getPageCopilotPrompt } from '../../routes/page-prompts/index.js';

export interface PageContext {
  pageType: string;
  entityId?: string;
  path?: string;
  contextData?: Record<string, unknown>;
  systemPromptHint?: string;
}

export function buildPageContextSection(pageContext: PageContext | undefined | null): string {
  if (!pageContext?.pageType) return '';

  const parts: string[] = [];
  parts.push('## Page Context');
  parts.push(`The user is currently viewing: **${pageContext.pageType}**`);

  if (pageContext.entityId) {
    parts.push(`Entity: ${pageContext.entityId}`);
  }

  if (pageContext.path) {
    parts.push(`Working directory: \`${pageContext.path}\``);
  }

  if (pageContext.contextData) {
    const json = JSON.stringify(pageContext.contextData, null, 2);
    if (json.length > 5000) {
      parts.push(`\nContext data (truncated):\n\`\`\`json\n${json.slice(0, 5000)}\n...\n\`\`\``);
    } else {
      parts.push(`\nContext data:\n\`\`\`json\n${json}\n\`\`\``);
    }
  }

  if (pageContext.systemPromptHint) {
    parts.push(`\n${pageContext.systemPromptHint}`);
  }

  const copilotPrompt = getPageCopilotPrompt(
    pageContext.pageType,
    pageContext.contextData,
    !!pageContext.entityId,
  );
  if (copilotPrompt) {
    parts.push(copilotPrompt);
  }

  return '\n\n' + parts.join('\n');
}
