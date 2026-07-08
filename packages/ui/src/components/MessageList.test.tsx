// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MessageList, resolveAttachmentImageSrc } from './MessageList';
import type { Message } from '../types';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Hello! This is a test response.',
    timestamp: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('MessageList', () => {
  it('renders metadata-only user image attachments as chips', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          {
            id: 'msg-1',
            role: 'user',
            content: 'Analyze this',
            timestamp: '2026-01-01T00:00:00.000Z',
            attachments: [
              {
                type: 'image',
                mimeType: 'image/png',
                filename: 'diagram.png',
                size: 1536,
              },
            ],
          },
        ]}
      />
    );

    expect(html).toContain('diagram.png');
    expect(html).toContain('2 KB');
    expect(html).not.toContain('<img');
  });

  it('keeps rendering available image data as thumbnails', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          {
            id: 'msg-1',
            role: 'user',
            content: 'Analyze this',
            timestamp: '2026-01-01T00:00:00.000Z',
            attachments: [
              {
                type: 'image',
                mimeType: 'image/png',
                filename: 'diagram.png',
                data: 'aGVsbG8=',
              },
            ],
          },
        ]}
      />
    );

    expect(html).toContain('<img');
    expect(html).toContain('data:image/png;base64,aGVsbG8=');
    expect(html).toContain('diagram.png');
  });

  it('blocks unsafe inline image attachment data', () => {
    expect(
      resolveAttachmentImageSrc({
        type: 'image',
        mimeType: 'image/svg+xml',
        filename: 'xss.svg',
        data: 'PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+',
      })
    ).toBeUndefined();
  });

  it('resolves saved image attachment paths through the file workspace route', () => {
    const html = renderToStaticMarkup(
      <MessageList
        workspaceId="ws-1"
        messages={[
          {
            id: 'msg-1',
            role: 'user',
            content: 'Here is the saved image',
            timestamp: '2026-01-01T00:00:00.000Z',
            attachments: [
              {
                type: 'image',
                mimeType: 'image/png',
                filename: 'chart.png',
                path: '/outputs/chart.png',
              },
            ],
          },
        ]}
      />
    );

    expect(html).toContain('<img');
    expect(html).toContain('/api/v1/file-workspaces/ws-1/file/outputs/chart.png?raw=true');
    expect(html).not.toContain('/api/v1/files/workspace');
  });

  it('blocks traversal in saved image attachment paths', () => {
    expect(
      resolveAttachmentImageSrc(
        {
          type: 'image',
          mimeType: 'image/png',
          filename: 'secret.png',
          path: '../../../secret.png',
        },
        'ws-1'
      )
    ).toBeUndefined();

    expect(
      resolveAttachmentImageSrc({
        type: 'image',
        mimeType: 'image/png',
        filename: 'secret.png',
        path: '..\\..\\secret.png',
      })
    ).toBeUndefined();
  });

  it('renders empty state', () => {
    const html = renderToStaticMarkup(<MessageList messages={[]} />);
    expect(html).not.toContain('Hello');
  });

  it('renders user message with avatar', () => {
    const html = renderToStaticMarkup(
      <MessageList messages={[message({ role: 'user', content: 'User message content' })]} />
    );
    expect(html).toContain('User message content');
  });

  it('renders assistant message with avatar', () => {
    const html = renderToStaticMarkup(
      <MessageList messages={[message({ content: 'Assistant reply' })]} />
    );
    expect(html).toContain('Assistant reply');
  });

  it('renders error message with error styling', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[message({ role: 'user', isError: true, content: 'Something failed' })]}
      />
    );
    expect(html).toContain('Something failed');
  });

  it('renders timestamps', () => {
    const html = renderToStaticMarkup(
      <MessageList messages={[message({ timestamp: '2026-06-15T14:30:00.000Z' })]} />
    );
    // Timestamps are rendered as locale time string
    expect(html).toContain(':');
  });

  it('shows retry button for last error message when canRetry is true', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          message({
            id: 'msg-err',
            role: 'user',
            isError: true,
            content: 'Error message',
            timestamp: '2026-01-01T00:00:00.000Z',
          }),
        ]}
        canRetry
        onRetry={vi.fn()}
      />
    );
    expect(html).toContain('Retry Message');
  });

  it('shows thinking content header when present', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          message({
            content: 'Final answer',
            thinkingContent: 'I need to reason about this...',
          }),
        ]}
      />
    );
    // Header is always visible — content is behind a collapsible toggle
    expect(html).toContain('Thought Process');
    // Content is hidden by default (collapsed)
    expect(html).not.toContain('I need to reason about this');
  });

  it('shows + context attached indicator for attached context', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          message({
            role: 'user',
            content: 'Analyze this\n---\n[ATTACHED CONTEXT]some context here',
          }),
        ]}
      />
    );
    expect(html).toContain('+ context attached');
    // The [ATTACHED CONTEXT] marker should be stripped from display
    expect(html).not.toContain('[ATTACHED CONTEXT]');
  });

  it('shows tool calls section when toolCalls are present', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          message({
            toolCalls: [
              {
                id: 'tc-1',
                name: 'read_file',
                arguments: { path: '/test.txt' },
                result: { content: 'file content' },
              },
            ],
          }),
        ]}
      />
    );
    expect(html).toContain('Tool Calls');
  });

  it('shows trace display when trace is present', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          message({
            trace: {
              duration: 500,
              toolCalls: [
                {
                  name: 'read_file',
                  arguments: {},
                  result: 'file content',
                  duration: 100,
                  success: true,
                },
              ],
              modelCalls: [],
              autonomyChecks: [],
              dbOperations: { reads: 1, writes: 0 },
              memoryOps: { adds: 0, recalls: 0 },
              triggersFired: [],
              errors: [],
              events: [],
            },
          }),
        ]}
      />
    );
    expect(html).toContain('Debug Info');
  });

  it('renders code block content', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          message({
            content: 'Here is some code:\n```js\nconst x = 1;\n```',
          }),
        ]}
      />
    );
    expect(html).toContain('const');
    expect(html).toContain('x');
  });

  it('includes copy button on messages', () => {
    const html = renderToStaticMarkup(
      <MessageList messages={[message({ content: 'Copyable content' })]} />
    );
    expect(html).toContain('Copy');
  });

  it('strips TOOL CATALOG markers from display', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          message({
            role: 'user',
            content: 'My question\n---\n[TOOL CATALOG]hidden',
          }),
        ]}
      />
    );
    expect(html).toContain('My question');
    expect(html).not.toContain('[TOOL CATALOG]');
    expect(html).toContain('+ context attached');
  });

  it('shows empty attachment chip size when size is 0', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          {
            id: 'msg-1',
            role: 'user',
            content: 'Check this',
            timestamp: '2026-01-01T00:00:00.000Z',
            attachments: [
              {
                type: 'file',
                filename: 'readme.txt',
                size: 0,
              },
            ],
          },
        ]}
      />
    );
    expect(html).toContain('readme.txt');
    // Size 0 should not display a size badge
    expect(html).not.toContain('0 B');
  });

  it('renders attachment with size in MB', () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          {
            id: 'msg-1',
            role: 'user',
            content: 'Large file',
            timestamp: '2026-01-01T00:00:00.000Z',
            attachments: [
              {
                type: 'file',
                filename: 'video.mp4',
                size: 5 * 1024 * 1024,
              },
            ],
          },
        ]}
      />
    );
    expect(html).toContain('5.0 MB');
  });
});

describe('resolveAttachmentImageSrc', () => {
  it('handles null attachment data gracefully', () => {
    expect(
      resolveAttachmentImageSrc({
        type: 'image',
      })
    ).toBeUndefined();
  });

  it('resolves legacy workspace path without workspaceId', () => {
    const result = resolveAttachmentImageSrc({
      type: 'image',
      path: 'outputs/diagram.png',
    });
    expect(result).toBe('/api/v1/files/workspace/outputs/diagram.png');
  });

  it('blocks path traversal in legacy mode', () => {
    const result = resolveAttachmentImageSrc({
      type: 'image',
      path: '../../../etc/passwd',
    });
    expect(result).toBeUndefined();
  });
});
