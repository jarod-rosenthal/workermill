import * as React from "react";
import type { Toast, ToastType } from "../components/ui/toast";
import { ToastContainer } from "../components/ui/toast";

/**
 * Default duration for auto-dismissing toasts (in milliseconds)
 */
const DEFAULT_TOAST_DURATION = 5000;

/**
 * Maximum number of toasts to display simultaneously
 */
const MAX_TOASTS = 5;

/**
 * Toast context value interface
 */
export interface ToastContextValue {
  /** Current list of active toasts */
  toasts: Toast[];
  /** Add a new toast notification */
  addToast: (toast: Omit<Toast, "id">) => string;
  /** Remove a toast by ID */
  removeToast: (id: string) => void;
  /** Shorthand for success toast */
  success: (message: string, duration?: number) => string;
  /** Shorthand for error toast */
  error: (message: string, duration?: number) => string;
  /** Shorthand for warning toast */
  warning: (message: string, duration?: number) => string;
  /** Shorthand for info toast */
  info: (message: string, duration?: number) => string;
}

/**
 * Toast context - provides toast notification functionality throughout the app
 */
const ToastContext = React.createContext<ToastContextValue | null>(null);

/**
 * Generate a unique ID for each toast
 */
function generateId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Default duration for toasts in milliseconds (default: 5000) */
  defaultDuration?: number;
  /** Maximum number of toasts to show at once (default: 5) */
  maxToasts?: number;
}

/**
 * Toast provider component - wrap your app with this to enable toast notifications
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ToastProvider>
 *       <YourApp />
 *     </ToastProvider>
 *   );
 * }
 * ```
 */
export const ToastProvider: React.FC<ToastProviderProps> = ({
  children,
  defaultDuration = DEFAULT_TOAST_DURATION,
  maxToasts = MAX_TOASTS,
}) => {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /**
   * Remove a toast by ID and clear its timer
   */
  const removeToast = React.useCallback((id: string) => {
    // Clear any existing timer for this toast
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  /**
   * Add a new toast notification
   * @returns The ID of the created toast
   */
  const addToast = React.useCallback(
    (toastData: Omit<Toast, "id">): string => {
      const id = generateId();
      const duration = toastData.duration ?? defaultDuration;

      const newToast: Toast = {
        ...toastData,
        id,
        duration,
      };

      setToasts((prev) => {
        // Limit the number of toasts, removing oldest first
        const updated = [...prev, newToast];
        if (updated.length > maxToasts) {
          // Remove oldest toasts that exceed the limit
          const toRemove = updated.slice(0, updated.length - maxToasts);
          toRemove.forEach((t) => {
            const timer = timersRef.current.get(t.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(t.id);
            }
          });
          return updated.slice(-maxToasts);
        }
        return updated;
      });

      // Set auto-dismiss timer if duration is positive
      if (duration > 0) {
        const timer = setTimeout(() => {
          removeToast(id);
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [defaultDuration, maxToasts, removeToast]
  );

  /**
   * Helper function to create typed toast shortcuts
   */
  const createToastShortcut = React.useCallback(
    (type: ToastType) =>
      (message: string, duration?: number): string =>
        addToast({ type, message, duration }),
    [addToast]
  );

  const success = React.useMemo(() => createToastShortcut("success"), [createToastShortcut]);
  const error = React.useMemo(() => createToastShortcut("error"), [createToastShortcut]);
  const warning = React.useMemo(() => createToastShortcut("warning"), [createToastShortcut]);
  const info = React.useMemo(() => createToastShortcut("info"), [createToastShortcut]);

  // Cleanup all timers on unmount
  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const contextValue = React.useMemo<ToastContextValue>(
    () => ({
      toasts,
      addToast,
      removeToast,
      success,
      error,
      warning,
      info,
    }),
    [toasts, addToast, removeToast, success, error, warning, info]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
};

/**
 * Hook to access toast notification functionality
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { success, error } = useToast();
 *
 *   const handleSave = async () => {
 *     try {
 *       await saveData();
 *       success('Data saved successfully');
 *     } catch (err) {
 *       error('Failed to save data');
 *     }
 *   };
 *
 *   return <button onClick={handleSave}>Save</button>;
 * }
 * ```
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
}

export default ToastProvider;
