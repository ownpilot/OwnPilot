import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageList } from './MessageList';

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
});
