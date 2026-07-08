// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { PageHomeTab } from './PageHomeTab';
import { Zap, CheckCircle2 } from './icons';

let root: Root | null = null;

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    flushSync(() => root?.render(element));
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const defaultProps: any = {
  heroIcons: [
    { icon: Zap, color: 'text-primary bg-primary/10' },
    { icon: CheckCircle2, color: 'text-green-500 bg-green-500/10' },
    { icon: Zap, color: 'text-blue-500 bg-blue-500/10' },
  ],
  title: 'Welcome',
  subtitle: 'Get started with this feature',
  cta: { label: 'Get Started', icon: Zap, onClick: vi.fn() },
  features: [
    {
      icon: Zap,
      color: 'text-violet-500 bg-violet-500/10',
      title: 'Fast',
      description: 'Lightning fast processing',
    },
    {
      icon: CheckCircle2,
      color: 'text-green-500 bg-green-500/10',
      title: 'Reliable',
      description: 'Always works',
    },
  ],
  steps: [
    { title: 'Install', detail: 'Run npm install' },
    { title: 'Configure', detail: 'Set up your config' },
  ],
};

describe('PageHomeTab', () => {
  it('renders skip home checkbox when onSkipHomeChange is provided', () => {
    const onSkipHomeChange = vi.fn();
    const container = render(
      <PageHomeTab {...defaultProps} onSkipHomeChange={onSkipHomeChange} skipHomeChecked={false} />
    );

    const checkbox = container.querySelector<HTMLInputElement>('#skip-home');
    expect(checkbox).toBeDefined();
    expect(checkbox!.checked).toBe(false);
    expect(container.textContent).toContain('Skip this screen next time');
  });

  it('renders skip home checkbox as checked when skipHomeChecked is true', () => {
    const container = render(
      <PageHomeTab {...defaultProps} onSkipHomeChange={vi.fn()} skipHomeChecked={true} />
    );

    const checkbox = container.querySelector<HTMLInputElement>('#skip-home');
    expect(checkbox).toBeDefined();
    expect(checkbox!.checked).toBe(true);
  });

  it('calls onSkipHomeChange when checkbox is toggled', () => {
    const onSkipHomeChange = vi.fn();
    const container = render(
      <PageHomeTab {...defaultProps} onSkipHomeChange={onSkipHomeChange} skipHomeChecked={false} />
    );

    const checkbox = container.querySelector<HTMLInputElement>('#skip-home');
    act(() => {
      checkbox!.click();
    });
    expect(onSkipHomeChange).toHaveBeenCalledWith(true);
  });

  it('does not render skip home checkbox when onSkipHomeChange is not provided', () => {
    const container = render(<PageHomeTab {...defaultProps} />);

    const checkbox = container.querySelector<HTMLInputElement>('#skip-home');
    expect(checkbox).toBeNull();
  });

  it('renders custom skip home label', () => {
    const container = render(
      <PageHomeTab {...defaultProps} onSkipHomeChange={vi.fn()} skipHomeLabel="Don't show again" />
    );

    expect(container.textContent).toContain("Don't show again");
  });

  it('renders quick actions when provided', () => {
    const onClick = vi.fn();
    const container = render(
      <PageHomeTab
        {...defaultProps}
        quickActions={[
          { icon: Zap, label: 'Action 1', description: 'First action', onClick },
          { icon: Zap, label: 'Action 2', description: 'Second action', onClick },
        ]}
      />
    );

    expect(container.textContent).toContain('Action 1');
    expect(container.textContent).toContain('Action 2');
    expect(container.textContent).toContain('Quick Actions');
  });

  it('calls quick action onClick when clicked', () => {
    const onClick = vi.fn();
    const container = render(
      <PageHomeTab
        {...defaultProps}
        quickActions={[{ icon: Zap, label: 'Run', description: 'Run now', onClick }]}
      />
    );

    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Run')
    );
    act(() => btn!.click());
    expect(onClick).toHaveBeenCalled();
  });

  it('renders info box when provided', () => {
    const container = render(
      <PageHomeTab
        {...defaultProps}
        infoBox={{
          icon: Zap,
          title: 'Info Title',
          description: 'Info description text',
          color: 'blue',
        }}
      />
    );

    expect(container.textContent).toContain('Info Title');
    expect(container.textContent).toContain('Info description text');
  });

  it('renders footer CTA when provided', () => {
    const onClick = vi.fn();
    const container = render(
      <PageHomeTab {...defaultProps} footerCta={{ label: 'Finish Setup', icon: Zap, onClick }} />
    );

    const footerBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Finish Setup')
    );
    expect(footerBtn).toBeDefined();
    act(() => footerBtn!.click());
    expect(onClick).toHaveBeenCalled();
  });

  it('renders children when provided', () => {
    const container = render(
      <PageHomeTab {...defaultProps}>
        <div data-testid="custom-child">Custom content</div>
      </PageHomeTab>
    );

    expect(container.querySelector('[data-testid="custom-child"]')).toBeDefined();
    expect(container.textContent).toContain('Custom content');
  });

  it('handles empty features array', () => {
    const container = render(<PageHomeTab {...defaultProps} features={[]} />);

    expect(container.textContent).not.toContain('Key Features');
  });

  it('handles empty steps array', () => {
    const container = render(<PageHomeTab {...defaultProps} steps={[]} />);

    expect(container.textContent).not.toContain('Getting Started');
  });
});
