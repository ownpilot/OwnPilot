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
});
