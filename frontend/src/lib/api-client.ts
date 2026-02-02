import axios from "axios";
import { useAuthStore } from "../store/auth-store";

const API_BASE_URL = "/api";

/**
 * Toast notification bridge for use outside React context.
 * Components that have access to useToast() should call setApiErrorToast()
 * to enable global error notifications.
 */
type ToastErrorFn = (message: string) => void;
let apiErrorToast: ToastErrorFn | null = null;

export function setApiErrorToast(toastFn: ToastErrorFn) {
  apiErrorToast = toastFn;
}

/**
 * Extract user-friendly error message from API response
 */
function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    // Try to get error message from response body
    const responseError = error.response?.data?.error;
    if (typeof responseError === "string") {
      return responseError;
    }
    // Fall back to status text or generic message
    if (error.response?.statusText) {
      return error.response.statusText;
    }
    if (error.message) {
      return error.message;
    }
  }
  return "An unexpected error occurred";
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    // Handle 401 (session expired) - redirect to login
    if (status === 401) {
      // Check if we're already on the login page to avoid redirect loops
      if (window.location.pathname !== "/login") {
        // Set flag so login page can show "session expired" message
        sessionStorage.setItem("sessionExpired", "true");

        // Use Zustand store to properly clear all auth state
        useAuthStore.getState().logout();

        // Redirect to login
        window.location.href = "/login";
      }
    }
    // Show toast notification for other errors (if toast function is available)
    // Skip 401 (handled above) and 400 (validation - usually handled inline)
    else if (apiErrorToast && status && status !== 400) {
      const message = getErrorMessage(error);
      apiErrorToast(message);
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: async (data: { email: string; password: string }) => {
    const response = await apiClient.post("/auth/login", data);
    return response.data as
      | {
          tokens: {
            accessToken: string;
            refreshToken: string;
            idToken: string;
            expiresIn: number;
          };
        }
      | {
          challengeRequired: true;
          challengeName: string;
          session: string;
          email: string;
        };
  },

  submitMfaChallenge: async (data: { email: string; session: string; code: string }) => {
    const response = await apiClient.post("/auth/mfa-challenge", data);
    return response.data as {
      tokens: {
        accessToken: string;
        refreshToken: string;
        idToken: string;
        expiresIn: number;
      };
    };
  },

  signup: async (data: {
    email: string;
    password: string;
    name: string;
    organizationName?: string; // Optional - not required if user has a pending invite
    referralCode?: string;
    tosAccepted?: boolean;
  }) => {
    const response = await apiClient.post("/auth/signup", data);
    return response.data as {
      message: string;
      user: { id: string; email: string; name: string };
      organization: { id: string; name: string };
      referralApplied?: boolean;
      referralDiscount?: { percent: number; months: number };
      userConfirmed?: boolean; // True if user was auto-confirmed (e.g., via invite flow)
      inviteToken?: string; // Token returned when pending invite detected for email
    };
  },

  getMe: async () => {
    const response = await apiClient.get("/auth/me");
    return response.data as {
      user: { id: string; email: string; fullName: string; role: string; status: string };
      organization: { id: string; name: string; plan: string } | null;
      needsSetup: boolean;
    };
  },

  checkPendingInvite: async () => {
    const response = await apiClient.get("/auth/pending-invite");
    return response.data as {
      pendingInvite: boolean;
      inviteToken?: string;
      organizationName?: string;
      role?: string;
    };
  },

  completeSetup: async (data: { action: "create"; organizationName: string } | { action: "join"; inviteToken: string }) => {
    const response = await apiClient.post("/auth/complete-setup", data);
    return response.data as {
      message: string;
      organization: { id: string; name: string; plan: string };
    };
  },

  logout: () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("idToken");
  },

  confirmEmail: async (data: { email: string; code: string }) => {
    const response = await apiClient.post("/auth/confirm", data);
    return response.data as { message: string };
  },

  resendCode: async (data: { email: string }) => {
    const response = await apiClient.post("/auth/resend-code", data);
    return response.data as { message: string };
  },

  getSsoConfig: async () => {
    const response = await apiClient.get("/auth/sso-config");
    return response.data as {
      enabled: boolean;
      providers: { name: string; displayName: string }[];
      clientId: string;
      hostedUiBaseUrl: string;
    };
  },

  ssoCallback: async (data: { code: string; redirectUri: string }) => {
    const response = await apiClient.post("/auth/sso-callback", data);
    return response.data;
  },

  // Microsoft Work Account SSO (direct OAuth, not via Cognito)
  getMicrosoftAuthUrl: async (inviteToken?: string) => {
    const params = inviteToken ? { inviteToken } : {};
    const response = await apiClient.get("/auth/microsoft/authorize", { params });
    return response.data as {
      authorizeUrl: string;
      state: string;
      redirectUri: string;
    };
  },

  microsoftCallback: async (data: { code: string; redirectUri: string; state?: string }) => {
    const response = await apiClient.post("/auth/microsoft/callback", data);
    return response.data as {
      tokens: {
        accessToken: string;
        refreshToken: string;
        idToken: string;
        expiresIn: number;
      };
      user: {
        id: string;
        email: string;
        fullName: string;
        role: string;
        status: string;
      };
      organization: {
        id: string;
        name: string;
        plan: string;
      } | null;
      isNewUser: boolean;
      isNewOrg: boolean;
      inviteToken?: string;
      pendingInvite?: boolean;
    };
  },
};

// Profile API (MFA)
export const profileAPI = {
  getMfaStatus: async () => {
    const response = await apiClient.get("/profile/mfa/status");
    return response.data as {
      mfaEnabled: boolean;
      mfaType: "totp" | null;
    };
  },

  setupMfa: async () => {
    const response = await apiClient.post("/profile/mfa/setup");
    return response.data as {
      secretCode: string;
      totpUri: string;
      issuer: string;
      accountName: string;
    };
  },

  verifyMfa: async (code: string) => {
    const response = await apiClient.post("/profile/mfa/verify", { code });
    return response.data as {
      success: boolean;
      message: string;
    };
  },

  disableMfa: async (password: string, code: string) => {
    const response = await apiClient.post("/profile/mfa/disable", { password, code });
    return response.data as {
      success: boolean;
      message: string;
    };
  },
};

// Referrals API
export const referralsAPI = {
  validateCode: async (data: { code: string; email: string }) => {
    const response = await apiClient.post("/referrals/validate", data);
    return response.data as {
      valid: boolean;
      error?: string;
      rewards?: { discountPercent: number; discountMonths: number; description: string };
    };
  },

  getInfo: async () => {
    const response = await apiClient.get("/referrals/info");
    return response.data;
  },
};

// Tasks API
export const tasksAPI = {
  list: async (params?: { status?: string; limit?: number; offset?: number }) => {
    const response = await apiClient.get("/tasks", { params });
    return response.data;
  },

  get: async (id: string) => {
    const response = await apiClient.get(`/tasks/${id}`);
    return response.data;
  },

  getLogs: async (id: string, params?: { nextToken?: string; limit?: number }) => {
    const response = await apiClient.get(`/tasks/${id}/logs`, { params });
    return response.data;
  },

  cancel: async (id: string) => {
    const response = await apiClient.post(`/tasks/${id}/cancel`);
    return response.data;
  },

  retry: async (id: string) => {
    const response = await apiClient.post(`/tasks/${id}/retry`);
    return response.data;
  },
};

// Control Center API (for dashboard stats)
export const controlCenterAPI = {
  getData: async () => {
    const response = await apiClient.get("/control-center");
    return response.data;
  },

  getTaskLogs: async (taskId: string) => {
    const response = await apiClient.get(`/control-center/logs/${taskId}`);
    return response.data;
  },
};

// Organizations API (multi-org support)
export interface UserOrganization {
  id: string;
  name: string;
  slug: string | null;
  role: "owner" | "admin" | "member";
  isDefault: boolean;
  joinedAt: string;
}

export const organizationsAPI = {
  list: async () => {
    const response = await apiClient.get<{ organizations: UserOrganization[]; currentOrgId: string | null }>("/settings/organizations");
    return response.data.organizations;
  },

  switchOrg: async (orgId: string) => {
    const response = await apiClient.post("/settings/organizations/switch", { orgId });
    return response.data as { message: string; organization: { id: string; name: string } };
  },

  setDefault: async (orgId: string) => {
    const response = await apiClient.put("/settings/organizations/default", { orgId });
    return response.data as { message: string };
  },
};

export default apiClient;
