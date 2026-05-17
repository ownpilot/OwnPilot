import { describe, expect, it } from 'vitest';
import { getSwitchExecutionDetails, type SwitchNodeData } from './SwitchConfigPanel';

describe('getSwitchExecutionDetails', () => {
  it('uses branchTaken from live execution events', () => {
    const details = getSwitchExecutionDetails({
      branchTaken: 'default',
      resolvedArgs: { evaluatedValue: 'unknown', matchedCase: 'fallback' },
    } as SwitchNodeData);

    expect(details).toEqual({
      evaluatedValue: 'unknown',
      branchTaken: 'default',
    });
  });

  it('falls back to resolvedArgs from the switch executor', () => {
    const details = getSwitchExecutionDetails({
      resolvedArgs: { evaluatedValue: '42', matchedCase: 'Forty-Two' },
    } as SwitchNodeData);

    expect(details).toEqual({
      evaluatedValue: '42',
      branchTaken: 'Forty-Two',
    });
  });

  it('falls back to executionOutput for the evaluated value', () => {
    const details = getSwitchExecutionDetails({
      executionOutput: { type: 'payment' },
      matchedCase: 'payment',
    } as SwitchNodeData);

    expect(details).toEqual({
      evaluatedValue: { type: 'payment' },
      branchTaken: 'payment',
    });
  });
});
