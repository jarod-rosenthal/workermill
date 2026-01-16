import * as React from "react";
import * as Sentry from "@sentry/react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * A reusable error boundary component that catches JavaScript errors in child
 * component tree and displays a fallback UI instead of crashing the whole app.
 *
 * Features:
 * - Catches errors in child components during rendering, lifecycle methods, and constructors
 * - Logs errors to Sentry for monitoring
 * - Provides a "Try Again" button to reset the error state
 * - Supports custom fallback UI via the `fallback` prop
 * - Supports dark mode styling
 */
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to Sentry
    Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);

    // Log to console in development
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught an error:", error);
      console.error("Component stack:", errorInfo.componentStack);
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <DefaultErrorFallback
          onRetry={this.handleRetry}
          error={this.state.error}
        />
      );
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  onRetry?: () => void;
  error?: Error;
  title?: string;
  description?: string;
  showRetry?: boolean;
  className?: string;
}

/**
 * Default error fallback component with a user-friendly message and retry button.
 */
function DefaultErrorFallback({
  onRetry,
  title = "Something went wrong",
  description = "We encountered an unexpected error. Please try again.",
  showRetry = true,
  className = "",
}: ErrorFallbackProps): React.ReactElement {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center ${className}`}
    >
      <div className="mb-4 rounded-full bg-red-100 p-3 dark:bg-red-900/20">
        <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mb-4 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
      {showRetry && onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </Button>
      )}
    </div>
  );
}

/**
 * Error fallback specifically styled for dashboard sections.
 * Compact design that fits within dashboard card layouts.
 */
function DashboardErrorFallback({
  onRetry,
}: {
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800/30 dark:bg-red-900/10">
      <AlertTriangle className="mb-2 h-5 w-5 text-red-500 dark:text-red-400" />
      <p className="mb-3 text-sm font-medium text-red-700 dark:text-red-300">
        Failed to load this section
      </p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="border-red-200 text-red-600 hover:bg-red-100 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          <RefreshCw className="mr-2 h-3 w-3" />
          Retry
        </Button>
      )}
    </div>
  );
}

/**
 * Error fallback for settings page sections.
 * Maintains the card styling of settings panels.
 */
function SettingsErrorFallback({
  onRetry,
  sectionName = "settings",
}: {
  onRetry?: () => void;
  sectionName?: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900/20">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-foreground">
            Unable to load {sectionName}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            There was a problem loading this section. Your other settings are
            unaffected.
          </p>
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="mt-3"
            >
              <RefreshCw className="mr-2 h-3 w-3" />
              Try Again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Error fallback for billing/cost breakdown sections.
 * Uses a subtle design that doesn't alarm users about payment issues.
 */
function BillingErrorFallback({
  onRetry,
}: {
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg bg-gray-50 p-8 dark:bg-gray-800/50">
      <AlertTriangle className="mb-3 h-6 w-6 text-gray-400 dark:text-gray-500" />
      <p className="mb-1 font-medium text-gray-700 dark:text-gray-300">
        Cost data unavailable
      </p>
      <p className="mb-4 text-center text-sm text-gray-500 dark:text-gray-400">
        We couldn&apos;t load the cost breakdown. Your billing status is
        unaffected.
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-3 w-3" />
          Reload
        </Button>
      )}
    </div>
  );
}

/**
 * A wrapper component that provides ErrorBoundary with a retry mechanism.
 * Use this when you want the ErrorBoundary to be able to reset itself.
 */
function ErrorBoundaryWithRetry({
  children,
  fallback,
  onError,
}: ErrorBoundaryProps): React.ReactElement {
  const [key, setKey] = React.useState(0);

  const handleRetry = React.useCallback(() => {
    setKey((prev) => prev + 1);
  }, []);

  // Clone the fallback and inject the onRetry handler if it's a valid element
  const fallbackWithRetry = React.isValidElement(fallback)
    ? React.cloneElement(fallback as React.ReactElement<{ onRetry?: () => void }>, {
        onRetry: handleRetry,
      })
    : fallback;

  return (
    <ErrorBoundary key={key} fallback={fallbackWithRetry} onError={onError}>
      {children}
    </ErrorBoundary>
  );
}

export {
  ErrorBoundary,
  ErrorBoundaryWithRetry,
  DefaultErrorFallback,
  DashboardErrorFallback,
  SettingsErrorFallback,
  BillingErrorFallback,
};

export type { ErrorBoundaryProps, ErrorBoundaryState, ErrorFallbackProps };
