// API
export const API_BASE_URL = "https://workermill.com/api";
export const SSE_BASE_URL = "https://workermill.com/api";

// Cognito (required for token refresh interceptor — do not hardcode in api-client.ts)
// COGNITO_REGION: The AWS region where the WorkerMill Cognito User Pool lives.
// COGNITO_CLIENT_ID: AWS Console → Cognito → User Pools → App clients → App client ID.
// Replace the placeholder below with the real value before committing.
export const COGNITO_REGION = "us-east-1";
export const COGNITO_CLIENT_ID = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || 'LOCAL_DEV_PLACEHOLDER';

// Validate required config in production builds
if (COGNITO_CLIENT_ID === 'LOCAL_DEV_PLACEHOLDER') {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[WorkerMill] EXPO_PUBLIC_COGNITO_CLIENT_ID not set — using placeholder. Auth will not work.');
  } else {
    throw new Error(
      'EXPO_PUBLIC_COGNITO_CLIENT_ID environment variable is required for production builds. ' +
      'Set it in your .env or eas.json build config.'
    );
  }
}

// AsyncStorage keys for Zustand persist middleware
// IMPORTANT: versioned — increment suffix when store shape changes
export const STORAGE_KEYS = {
  TASKS: "wm-tasks-v1",
  BOARDS: "wm-boards-v1",
  COORDINATION: "wm-coordination-v1",
  NOTIFICATIONS: "wm-notifications-v1",
} as const;