// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { CronBuilder } from './CronBuilder';

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
  getSelect: (label: string) => HTMLSelectElement | null;
  query: (selector: string) => Element | null;
  text: () => string;
  cleanup: () => void;
}

function renderCronBuilder(initialValue: string, onChange: (cron: string) => void): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(CronBuilder, { value: initialValue, onChange }));
  });

  return {
    container,
    root,
    getSelect: (label) => {
      const labels = container.querySelectorAll('label');
      for (const l of labels) {
        if (l.textContent?.trim() === label) {
          const select = l.parentElement?.querySelector('select');
          if (select instanceof HTMLSelectElement) return select;
        }
      }
      return null;
    },
    query: (selector) => container.querySelector(selector),
    text: () => container.textContent ?? '',
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('CronBuilder preset detection', () => {
  it('initialises custom preset when value is not in presets', () => {
    const r = renderCronBuilder('1 2 3 4 5', vi.fn());
    // No preset button should be highlighted — the only way to assert is
    // that custom fields are visible
    expect(r.query('select')).not.toBeNull();
    r.cleanup();
  });

  it('shows the every-minute preset label in the schedule preview', () => {
    const r = renderCronBuilder('*/1 * * * *', vi.fn());
    expect(r.text()).toContain('Runs every minute');
    r.cleanup();
  });

  it('shows the every-N-minutes label for */5', () => {
    const r = renderCronBuilder('*/5 * * * *', vi.fn());
    expect(r.text()).toContain('Runs every 5 minutes');
    r.cleanup();
  });

  it('shows the every-hour label', () => {
    const r = renderCronBuilder('0 * * * *', vi.fn());
    expect(r.text()).toContain('Runs every hour');
    r.cleanup();
  });

  it('shows the every-N-hours label for */2', () => {
    const r = renderCronBuilder('0 */2 * * *', vi.fn());
    expect(r.text()).toContain('Runs every 2 hours');
    r.cleanup();
  });

  it('shows the daily time label', () => {
    const r = renderCronBuilder('30 9 * * *', vi.fn());
    expect(r.text()).toContain('Runs every day at 09:30');
    r.cleanup();
  });

  it('shows the weekly day name label', () => {
    const r = renderCronBuilder('0 9 * * 1', vi.fn());
    expect(r.text()).toContain('Runs every Monday at 09:00');
    r.cleanup();
  });

  it('shows the monthly day-of-month label', () => {
    const r = renderCronBuilder('0 7 15 * *', vi.fn());
    expect(r.text()).toContain('Runs on day 15 of every month at 07:00');
    r.cleanup();
  });

  it('falls back to raw cron parts when no pattern matches', () => {
    const r = renderCronBuilder('13 25 40 13 7', vi.fn());
    expect(r.text()).toContain('Runs at:');
    r.cleanup();
  });

  it('returns the parsed cron string in the schedule preview footer', () => {
    const r = renderCronBuilder('0 0 * * *', vi.fn());
    expect(r.text()).toContain('0 0 * * *');
    r.cleanup();
  });
});

describe('CronBuilder interactions', () => {
  it('fires onChange with preset value when a preset button is clicked', () => {
    const onChange = vi.fn();
    const r = renderCronBuilder('0 0 * * *', onChange);
    // The initial preset is "daily" because value matches; clicking weekly
    // should switch to the weekly cron string.
    const weeklyButton = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Every Monday at 9 AM'
    );
    expect(weeklyButton).toBeTruthy();
    act(() => {
      weeklyButton?.click();
    });
    expect(onChange).toHaveBeenLastCalledWith('0 9 * * 1');
    r.cleanup();
  });

  it('switches to custom when minute is edited after enabling custom', () => {
    const onChange = vi.fn();
    const r = renderCronBuilder('0 0 * * *', onChange);
    // Switch to custom preset first so the custom fields are visible
    const customButton = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Custom'
    );
    act(() => {
      customButton?.click();
    });

    const minuteSelect = r.getSelect('Minute');
    expect(minuteSelect).not.toBeNull();
    act(() => {
      const select = minuteSelect as unknown as HTMLSelectElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      setter?.call(select, '15');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith('15 0 * * *');
    r.cleanup();
  });

  it('keeps the custom field UI visible after editing minute', () => {
    const r = renderCronBuilder('0 0 * * *', vi.fn());
    const customButton = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Custom'
    );
    act(() => {
      customButton?.click();
    });

    const minuteSelect = r.getSelect('Minute');
    act(() => {
      const select = minuteSelect as unknown as HTMLSelectElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      setter?.call(select, '15');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    // After switch to custom, all five selects should be present.
    expect(r.container.querySelectorAll('select').length).toBeGreaterThanOrEqual(5);
    r.cleanup();
  });

  it('switches to custom when clicking the Custom preset button', () => {
    const r = renderCronBuilder('0 0 * * *', vi.fn());
    const customButton = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Custom'
    );
    expect(customButton).toBeTruthy();
    act(() => {
      customButton?.click();
    });
    // The custom field UI appears immediately
    expect(r.getSelect('Minute')).not.toBeNull();
    r.cleanup();
  });
});

describe('CronBuilder cron parsing edge cases', () => {
  it('falls back to wildcard when input is empty', () => {
    const r = renderCronBuilder('', vi.fn());
    // No preset active, custom visible, schedule preview is wildcard.
    expect(r.text()).toContain('* * * * *');
    r.cleanup();
  });

  it('falls back to wildcard when input has fewer than 5 parts', () => {
    const r = renderCronBuilder('0 0 *', vi.fn());
    expect(r.text()).toContain('* * * * *');
    r.cleanup();
  });

  it('falls back to wildcard when input has more than 5 parts', () => {
    const r = renderCronBuilder('0 0 * * * * 6', vi.fn());
    expect(r.text()).toContain('* * * * *');
    r.cleanup();
  });

  it('uses the trimmed value when input has extra whitespace', () => {
    const r = renderCronBuilder('  0   0   *   *   *  ', vi.fn());
    expect(r.text()).toContain('Runs every day at 00:00');
    r.cleanup();
  });
});
