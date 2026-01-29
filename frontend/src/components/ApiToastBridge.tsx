/**
 * ApiToastBridge
 *
 * Connects the API client's error interceptor to the toast notification system.
 * This component should be placed inside ToastProvider in App.tsx.
 *
 * Without this bridge, API errors outside React components won't show toast notifications.
 */

import { useEffect } from "react";
import { useToast } from "../contexts/ToastContext";
import { setApiErrorToast } from "../lib/api-client";

export function ApiToastBridge() {
  const { error } = useToast();

  useEffect(() => {
    // Connect the toast function to the API client
    setApiErrorToast(error);

    // Cleanup on unmount (though this component should never unmount)
    return () => {
      setApiErrorToast(() => {}); // no-op on unmount
    };
  }, [error]);

  // This component renders nothing
  return null;
}
