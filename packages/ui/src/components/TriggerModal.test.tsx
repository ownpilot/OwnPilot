// @vitest-environment happy-dom

import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TriggerModal, validateCron } from './TriggerModal';

// Mock API modules
vi.mock('../api', () => ({
  triggersApi: {
    list: vi.fn().mockResolvedValue({ triggers: [] }),
    update: vi.fn().mockResolvedValue({}),
  },
  workflowsApi: {
    list: vi.fn().mockResolvedValue({ workflows: [] }),
  },
  apiClient: {
    post: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../hooks', () => ({
  useModalClose: (onClose: () => void) => ({
    onBackdropClick: (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
  }),
}));

vi.mock('./icons', () => ({
  X: () => <span data-testid="icon-x">X</span>,
}));

vi.mock('../utils/ignore-error', () => ({
  silentCatch: () => vi.fn(),
}));

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

describe('TriggerModal', () => {
  it('renders create mode with default schedule type', () => {
    const container = render(<TriggerModal trigger={null} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(container.textContent).toContain('Create Trigger');
    expect(container.textContent).toContain('Schedule (Cron)');
    expect(container.textContent).toContain('Cron Expression');
    // Should show cron presets
    expect(container.textContent).toContain('Every hour');
    expect(container.textContent).toContain('Every morning (8:00)');
    // Should have Create button
    expect(container.textContent).toContain('Create');
    // Should have Cancel button
    expect(container.textContent).toContain('Cancel');
  });

  it('renders edit mode with existing trigger data', () => {
    const trigger = {
      id: 'trigger-1',
      name: 'Morning Briefing',
      description: 'Daily morning update',
      type: 'schedule' as const,
      config: { cron: '0 7 * * *' },
      action: { type: 'chat' as const, payload: { message: 'Good morning!' } },
      enabled: true,
      priority: 0,
      lastFired: null,
      nextFire: null,
      fireCount: 0,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    const container = render(<TriggerModal trigger={trigger} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(container.textContent).toContain('Edit Trigger');
    // Name is in an input value — check the input element
    const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(nameInput?.value).toBe('Morning Briefing');
    // Description is in the second text input
    const allTextInputs = container.querySelectorAll('input[type="text"]');
    expect(allTextInputs[1]?.getAttribute('value')).toBe('Daily morning update');
    // Should have Save button (not Create)
    expect(container.textContent).toContain('Save');
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    const container = render(<TriggerModal trigger={null} onClose={onClose} onSave={vi.fn()} />);

    const cancelBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Cancel'
    );
    expect(cancelBtn).not.toBeNull();

    act(() => {
      cancelBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking backdrop', () => {
    const onClose = vi.fn();
    const container = render(<TriggerModal trigger={null} onClose={onClose} onSave={vi.fn()} />);

    const backdrop = container.firstElementChild as HTMLElement;
    act(() => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches between trigger types and shows relevant fields', () => {
    const container = render(<TriggerModal trigger={null} onClose={vi.fn()} onSave={vi.fn()} />);

    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();

    // Default is schedule — shows Cron Expression
    expect(container.textContent).toContain('Cron Expression');

    // Switch to Event
    act(() => {
      select.value = 'event';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Event Type');
    expect(container.textContent).not.toContain('Cron Expression');

    // Switch to Condition
    act(() => {
      select.value = 'condition';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Condition');
    expect(container.textContent).toContain('Threshold');

    // Switch to Webhook
    act(() => {
      select.value = 'webhook';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Webhook Path');
  });

  it('shows workflow selector when action type is workflow', () => {
    const container = render(<TriggerModal trigger={null} onClose={vi.fn()} onSave={vi.fn()} />);

    const actionSelect = container.querySelectorAll('select')[1] as HTMLSelectElement;
    expect(actionSelect).not.toBeNull();

    // Switch to workflow action type
    act(() => {
      actionSelect.value = 'workflow';
      actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('Workflow');
    expect(container.textContent).toContain('No workflows found');
  });

  it('toggles advanced section', () => {
    const container = render(<TriggerModal trigger={null} onClose={vi.fn()} onSave={vi.fn()} />);

    // Advanced section should be hidden by default
    expect(container.textContent).not.toContain('Chain from');
    expect(container.textContent).not.toContain('Pre-run gating script');

    // Click the advanced toggle
    const advancedBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Advanced')
    );
    expect(advancedBtn).not.toBeNull();

    act(() => {
      advancedBtn?.click();
    });

    expect(container.textContent).toContain('Chain from');
    expect(container.textContent).toContain('Pre-run gating script');
  });

  it('shows pre-run code textarea when pre-run is enabled in advanced', () => {
    const container = render(<TriggerModal trigger={null} onClose={vi.fn()} onSave={vi.fn()} />);

    // Open advanced section
    const advancedBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Advanced')
    );
    act(() => {
      advancedBtn?.click();
    });

    // Check the pre-run checkbox
    const preRunCheckbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(preRunCheckbox).not.toBeNull();

    act(() => {
      preRunCheckbox.click();
    });

    // Textarea should now be visible
    expect(container.textContent).toContain('// Runs before the action');
  });

  it('disables Submit button when name is empty', () => {
    const container = render(<TriggerModal trigger={null} onClose={vi.fn()} onSave={vi.fn()} />);

    const submitBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.type === 'submit'
    ) as HTMLButtonElement;

    // Submit is disabled because name is empty
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);
  });

  it('submits the form with schedule trigger data', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const container = render(<TriggerModal trigger={null} onClose={onClose} onSave={onSave} />);

    // Fill in the name using native input value setter
    // React 19 controlled inputs need the native setter + input event to trigger state sync
    const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement;

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      nativeSetter?.call(nameInput, 'My Trigger');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Submit should now be enabled
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();

    act(() => {
      flushSync(() => {});
    });
    expect(submitBtn.disabled).toBe(false);

    // Submit the form
    await act(async () => {
      submitBtn.click();
    });

    // onSave should be called
    expect(onSave).toHaveBeenCalledTimes(1);
    // onClose should not be called automatically
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('validateCron', () => {
  it('returns valid for a correct cron expression', () => {
    expect(validateCron('0 8 * * *')).toEqual({ valid: true });
    expect(validateCron('*/15 * * * *')).toEqual({ valid: true });
    expect(validateCron('0 9 * * 1-5')).toEqual({ valid: true });
  });

  it('returns error for empty cron', () => {
    const result = validateCron('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns error for wrong number of fields', () => {
    const result = validateCron('0 8 * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Expected 5 fields');
  });

  it('returns error for out-of-range values', () => {
    const result = validateCron('60 8 * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('out of range');
  });

  it('returns error for invalid step values', () => {
    const result = validateCron('*/0 * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid step');
  });

  it('returns error for non-numeric values', () => {
    const result = validateCron('abc * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('is not a number');
  });
});
