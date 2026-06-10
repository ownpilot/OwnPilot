/**
 * MultiStepModal — shared shell for step-based modals.
 *
 * Owns the backdrop, panel, header with numbered step tabs, scrollable
 * content area, error line, and the Cancel / Back / Next / Submit footer.
 * Callers keep their own step state and render the current step's content
 * as children.
 *
 * Extracted from CreateAgentModal / EditAgentModal (which were ~90%
 * identical); new step-based modals should build on this instead of
 * copying the shell.
 */

import type { ReactNode } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import { Modal } from './Modal';

export interface MultiStepModalProps<S extends string> {
  title: string;
  /** Ordered step keys; tab labels are the capitalized keys. */
  steps: readonly S[];
  step: S;
  onStepChange: (step: S) => void;
  onClose: () => void;
  /** Replaces the content area with a spinner while initial data loads. */
  isLoading?: boolean;
  /** Error line rendered under the step content. */
  error?: string | null;
  /** Submit button label, e.g. "Create Agent". */
  submitLabel: string;
  /** Label while submitting, e.g. "Creating...". */
  submittingLabel: string;
  isSubmitting?: boolean;
  /** Disables the Submit button (in addition to isSubmitting). */
  canSubmit?: boolean;
  /** Disables the Next button on the current step. */
  canAdvance?: boolean;
  onSubmit: () => void;
  children: ReactNode;
}

export function MultiStepModal<S extends string>({
  title,
  steps,
  step,
  onStepChange,
  onClose,
  isLoading = false,
  error = null,
  submitLabel,
  submittingLabel,
  isSubmitting = false,
  canSubmit = true,
  canAdvance = true,
  onSubmit,
  children,
}: MultiStepModalProps<S>) {
  const stepIndex = steps.indexOf(step);
  const isLastStep = stepIndex === steps.length - 1;

  return (
    <Modal
      onClose={onClose}
      title={title}
      headerContent={
        <div className="flex gap-4 mt-3">
          {steps.map((s, i) => (
            <button
              key={s}
              onClick={() => onStepChange(s)}
              className={`text-sm font-medium ${
                step === s
                  ? 'text-primary border-b-2 border-primary pb-1'
                  : 'text-text-muted dark:text-dark-text-muted'
              }`}
            >
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      }
      footerClassName="p-4 border-t border-border dark:border-dark-border flex justify-between"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                onClick={() => onStepChange(steps[stepIndex - 1]!)}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Back
              </button>
            )}
            {isLastStep ? (
              <button
                onClick={onSubmit}
                disabled={isSubmitting || !canSubmit}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? submittingLabel : submitLabel}
              </button>
            ) : (
              <button
                onClick={() => onStepChange(steps[stepIndex + 1]!)}
                disabled={!canAdvance}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            )}
          </div>
        </>
      }
    >
      {isLoading ? <LoadingSpinner size="sm" message="Loading..." /> : children}
      {error && <p className="text-sm text-error mt-4">{error}</p>}
    </Modal>
  );
}
