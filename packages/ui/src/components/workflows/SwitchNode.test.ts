import { describe, expect, it } from 'vitest';
import { isDefaultSwitchBranch } from './SwitchNode';

describe('isDefaultSwitchBranch', () => {
  it('matches the backend default branch value', () => {
    expect(isDefaultSwitchBranch('default')).toBe(true);
  });

  it('accepts the UI label casing for default', () => {
    expect(isDefaultSwitchBranch('Default')).toBe(true);
  });

  it('does not treat named cases as default branches', () => {
    expect(isDefaultSwitchBranch('High Priority')).toBe(false);
    expect(isDefaultSwitchBranch(undefined)).toBe(false);
  });
});
