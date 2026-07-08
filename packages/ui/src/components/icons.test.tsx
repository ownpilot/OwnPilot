// @vitest-environment happy-dom
/**
 * Icons tests — custom SVG icons (Telegram, WhatsApp) and lucide-react re-exports.
 *
 * Custom icons receive SVGProps (className, etc.) and spread them onto the SVG element.
 * Lucide-react icons are re-exported by name; spot-check that known named exports exist.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Telegram, WhatsApp, Activity, Bot, Settings, X } from './icons';

function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('custom icons', () => {
  it('Telegram renders an SVG element', () => {
    const container = render(createElement(Telegram));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('Telegram passes className through', () => {
    const container = render(createElement(Telegram, { className: 'custom-class' }));
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toBe('custom-class');
  });

  it('WhatsApp renders an SVG element', () => {
    const container = render(createElement(WhatsApp));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('WhatsApp passes className through', () => {
    const container = render(createElement(WhatsApp, { className: 'my-icon' }));
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toBe('my-icon');
  });

  it('WhatsApp passes arbitrary props through', () => {
    const container = render(
      createElement(WhatsApp, { 'data-testid': 'wa-icon' } as React.SVGProps<SVGSVGElement>)
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-testid')).toBe('wa-icon');
  });
});

describe('lucide-react re-exports', () => {
  it('exports Activity as a component', () => {
    const container = render(createElement(Activity, { className: 'lucide' }));
    const svg = container.querySelector('svg.lucide');
    expect(svg).not.toBeNull();
  });

  it('exports Bot as a component', () => {
    const container = render(createElement(Bot, { className: 'bot-icon' }));
    const svg = container.querySelector('svg.bot-icon');
    expect(svg).not.toBeNull();
  });

  it('exports Settings as a component', () => {
    const container = render(createElement(Settings));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('exports X as a component', () => {
    const container = render(createElement(X));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});
