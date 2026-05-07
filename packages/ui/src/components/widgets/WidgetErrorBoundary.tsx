import React, { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
    console.error('[WidgetErrorBoundary]', error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!, this.reset);
      }
      return (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4">
          <div className="flex items-center gap-2 text-red-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium">Widget Error</span>
          </div>
          {this.state.error && (
            <p className="mt-2 text-sm text-red-300/80">
              {this.state.error.message || 'An error occurred while rendering this widget'}
            </p>
          )}
          <button
            onClick={this.reset}
            className="mt-3 rounded bg-red-500/20 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/30"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export function useWidgetErrorBoundary(
  onError?: (error: Error, info: React.ErrorInfo) => void
) {
  const [error, setError] = React.useState<Error | null>(null);

  const reset = React.useCallback(() => setError(null), []);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  const boundary = React.useMemo(
    () => ({
      onError: (err: Error, info: React.ErrorInfo) => {
        setError(err);
        onError?.(err, info);
      },
      reset,
    }),
    [onError, reset]
  );

  return { boundary, error, reset };
}