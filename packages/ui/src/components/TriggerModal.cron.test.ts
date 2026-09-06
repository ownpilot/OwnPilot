/**
 * Tests for the client-side cron validator exported from TriggerModal.
 *
 * 'L' (last day of month) is accepted by the backend scheduler
 * (@ownpilot/core validateCronExpression, used by the gateway /triggers
 * routes) for the Day field only — the UI validator must accept exactly the
 * same, otherwise triggers the platform supports cannot be saved from the
 * web UI (TriggerModal + TriggerWizard both gate on this function).
 */
import { validateCron } from './TriggerModal';

describe('validateCron', () => {
  describe("'L' (last day of month) parity with the backend", () => {
    it("accepts 'L' in the Day field", () => {
      const result = validateCron('0 9 L * *');
      expect(result.valid, result.error).toBe(true);
    });

    it("accepts 'L' combined with a month restriction", () => {
      const result = validateCron('0 9 L 2 *');
      expect(result.valid, result.error).toBe(true);
    });

    it("rejects 'L' outside the Day field", () => {
      // hour field
      expect(validateCron('0 L * * *').valid).toBe(false);
      // month field
      expect(validateCron('0 9 * L *').valid).toBe(false);
    });

    it("rejects malformed 'L' usage", () => {
      expect(validateCron('0 9 L-5 * *').valid).toBe(false);
    });
  });

  describe('range with step (n-m/s) parity with the backend', () => {
    it('accepts a minute range with a step', () => {
      const result = validateCron('5-10/2 * * * *');
      expect(result.valid, result.error).toBe(true);
    });

    it('accepts an hour range with a step (every 2h from 9 to 17)', () => {
      const result = validateCron('0 9-17/2 * * *');
      expect(result.valid, result.error).toBe(true);
    });

    it('accepts a day-of-month range with a step', () => {
      const result = validateCron('0 9 1-10/3 * *');
      expect(result.valid, result.error).toBe(true);
    });

    it('still rejects step values <= 0 or non-numeric on ranges', () => {
      expect(validateCron('5-10/0 * * * *').valid).toBe(false);
      expect(validateCron('5-10/x * * * *').valid).toBe(false);
    });

    it('still accepts plain ranges without steps', () => {
      const result = validateCron('0 9-17 * * *');
      expect(result.valid, result.error).toBe(true);
    });

    it('still rejects garbage ranges', () => {
      expect(validateCron('a-b * * * *').valid).toBe(false);
    });
  });

  describe('established behavior (unchanged)', () => {
    it('accepts a plain 5-field expression', () => {
      const result = validateCron('0 9 1 * *');
      expect(result.valid, result.error).toBe(true);
    });

    it('rejects wrong field count', () => {
      expect(validateCron('* * * *').valid).toBe(false);
    });

    it('rejects out-of-range values', () => {
      expect(validateCron('60 * * * *').valid).toBe(false);
    });
  });
});
