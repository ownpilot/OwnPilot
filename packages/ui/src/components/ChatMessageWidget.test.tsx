import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatMessageWidget } from './ChatMessageWidget';

describe('ChatMessageWidget', () => {
  it('renders cards items instead of falling back to JSON', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="cards"
        data={{
          items: [
            {
              title: 'Görev & Hedefler',
              detail: 'Task ekle/listele/tamamla, hedef oluştur',
            },
            {
              title: 'Notlar & Hafıza',
              detail: 'Notları al, kalıcı hafıza oluştur',
            },
          ],
        }}
      />
    );

    expect(html).toContain('Görev &amp; Hedefler');
    expect(html).toContain('Task ekle/listele/tamamla');
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('Widget could not be rendered');
  });

  it('renders cards when payload arrives as a JSON string', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="cards"
        data={JSON.stringify({
          items: [{ title: 'Takvim & Kişiler', detail: 'Etkinlik planla' }],
        })}
      />
    );

    expect(html).toContain('Takvim &amp; Kişiler');
    expect(html).toContain('Etkinlik planla');
    expect(html).not.toContain('<pre');
  });

  it('shows raw data disclosure when widget data is malformed', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="cards"
        data={{ error: 'Invalid widget data', raw: '{ broken json " missing close' }}
      />
    );

    expect(html).toContain('Widget could not be rendered');
    expect(html).toContain('Show raw data');
    expect(html).toContain('broken json');
  });

  it('promotes string items in cards to titled records', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget name="cards" data={{ items: ['Privacy first', 'Local-only'] }} />
    );

    expect(html).toContain('Privacy first');
    expect(html).toContain('Local-only');
    expect(html).not.toContain('<pre');
  });

  it('promotes "key: value" strings in key_value to records', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="key_value"
        data={{ items: ['OS: Windows', 'Node.js: v24'] }}
      />
    );

    expect(html).toContain('OS');
    expect(html).toContain('Windows');
    expect(html).toContain('Node.js');
    expect(html).not.toContain('<pre');
  });

  it('renders key-value items instead of falling back to JSON', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="key_value"
        data={{
          items: [
            { key: 'food', value: '400€' },
            { label: 'housing', value: '800€' },
          ],
        }}
      />
    );

    expect(html).toContain('food');
    expect(html).toContain('400€');
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('Widget could not be rendered');
  });

  // Code & Media widget tests
  it('renders code widget with language and content', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="code"
        data={{ language: 'javascript', code: 'const x = 42;' }}
      />
    );

    expect(html).toContain('const x = 42;');
    expect(html).toContain('javascript');
  });

  it('renders image widget with src and alt', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="image"
        data={{ src: 'https://example.com/photo.jpg', alt: 'A photo' }}
      />
    );

    expect(html).toContain('photo.jpg');
    expect(html).toContain('A photo');
  });

  it('renders images widget with multiple images', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="images"
        data={{
          items: [
            { src: 'https://example.com/1.jpg', alt: 'First' },
            { src: 'https://example.com/2.jpg', alt: 'Second' },
          ],
        }}
      />
    );

    expect(html).toContain('1.jpg');
    expect(html).toContain('2.jpg');
    expect(html).toContain('First');
    expect(html).toContain('Second');
  });

  it('renders file widget with name and size', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="file"
        data={{ name: 'report.pdf', size: 2048576, type: 'application/pdf' }}
      />
    );

    expect(html).toContain('report.pdf');
    expect(html).toContain('2'); // 2 MB formatted
  });

  it('renders files widget with multiple files', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="files"
        data={{
          items: [
            { name: 'doc1.pdf', size: 1024 },
            { name: 'doc2.pdf', size: 2048 },
          ],
        }}
      />
    );

    expect(html).toContain('doc1.pdf');
    expect(html).toContain('doc2.pdf');
  });

  it('renders video widget with url', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="video"
        data={{ src: 'https://example.com/video.mp4' }}
      />
    );

    expect(html).toContain('video.mp4');
    expect(html).toContain('<video');
  });

  it('renders audio widget with url', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="audio"
        data={{ src: 'https://example.com/podcast.mp3' }}
      />
    );

    expect(html).toContain('podcast.mp3');
    expect(html).toContain('<audio');
  });

  it('renders chart widget with bar data', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="chart"
        data={{
          type: 'bar',
          title: 'Usage Stats',
          data: [
            { label: 'Mon', value: 120 },
            { label: 'Tue', value: 80 },
          ],
        }}
      />
    );

    expect(html).toContain('Usage Stats');
    expect(html).toContain('Mon');
  });

  it('renders pie_chart widget', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="pie_chart"
        data={{
          type: 'pie',
          data: [
            { label: 'A', value: 60 },
            { label: 'B', value: 40 },
          ],
        }}
      />
    );

    expect(html).toContain('A');
    expect(html).toContain('B');
  });

  it('renders embed widget with iframe src', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="embed"
        data={{ src: 'https://example.com/embed', title: 'Example' }}
      />
    );

    expect(html).toContain('example.com');
    expect(html).toContain('<iframe');
  });

  it('renders iframe widget', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="iframe"
        data={{ src: 'https://youtube.com/embed/video', title: 'Video' }}
      />
    );

    expect(html).toContain('youtube.com');
    expect(html).toContain('<iframe');
  });

  it('renders html widget with sanitized content', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="html"
        data={{ html: '<p>Hello <strong>World</strong></p>', title: 'Test' }}
      />
    );

    expect(html).toContain('Hello');
    expect(html).toContain('World');
  });

  it('renders json widget with pretty-printed data', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="json"
        data={{ name: 'test-widget', version: 1 }}
      />
    );

    expect(html).toContain('test-widget');
    expect(html).toContain('version');
  });

  it('renders raw widget fallback for unknown type', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget name="unknown_widget" data={{ key: 'value' }} />
    );

    expect(html).toContain('unknown_widget');
    expect(html).toContain('key');
  });

  it('renders progress widget with percentage', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="progress"
        data={{ label: 'Uploading', value: 75, max: 100 }}
      />
    );

    expect(html).toContain('Uploading');
    expect(html).toContain('75');
  });

  it('renders timeline widget with events', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="timeline"
        data={{
          items: [
            { label: 'Task 1', time: '09:00', detail: 'Started' },
            { label: 'Task 2', time: '10:00', detail: 'Completed' },
          ],
        }}
      />
    );

    expect(html).toContain('Task 1');
    expect(html).toContain('Task 2');
    expect(html).toContain('09:00');
    expect(html).toContain('10:00');
  });

  it('renders table widget with headers and rows', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="table"
        data={{
          title: 'Costs',
          headers: ['Item', 'Amount'],
          rows: [
            ['Hosting', '50€'],
            ['Domain', '10€'],
          ],
        }}
      />
    );

    expect(html).toContain('Costs');
    expect(html).toContain('Item');
    expect(html).toContain('Amount');
    expect(html).toContain('Hosting');
    expect(html).toContain('50€');
  });

  it('renders steps widget with ordered items', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="steps"
        data={{
          items: [
            { label: 'Step 1', detail: 'First action' },
            { label: 'Step 2', detail: 'Second action' },
          ],
        }}
      />
    );

    expect(html).toContain('Step 1');
    expect(html).toContain('Step 2');
    expect(html).toContain('First action');
  });

  it('renders callout widget with info tone', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="callout"
        data={{ title: 'Note', body: 'Important info here', tone: 'info' }}
      />
    );

    expect(html).toContain('Note');
    expect(html).toContain('Important info here');
  });

  it('renders callout widget with warning tone', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="callout"
        data={{ body: 'Be careful!', tone: 'warning' }}
      />
    );

    expect(html).toContain('Be careful');
  });

  it('handles checklist with done items', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="checklist"
        data={{
          items: [
            { label: 'Task 1', done: true },
            { label: 'Task 2', done: false },
          ],
        }}
      />
    );

    expect(html).toContain('Task 1');
    expect(html).toContain('Task 2');
  });

  it('normalizes metric_grid with array data', () => {
    const html = renderToStaticMarkup(
      <ChatMessageWidget
        name="metric_grid"
        data={[
          { label: 'CPU', value: '45%' },
          { label: 'Memory', value: '2.1GB' },
        ]}
      />
    );

    expect(html).toContain('CPU');
    expect(html).toContain('Memory');
    expect(html).toContain('45%');
  });
});
