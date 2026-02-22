import { create } from "zustand";

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
}

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  supportAdmin?: boolean;
  isPlatformAdmin?: boolean;
}

interface Organization {
  id: string;
  name: string;
  plan: string;
  trialExpiresAt: string | null;
  stripeSubscriptionStatus: string | null;
}

interface AuthState {
  isAuthenticated: boolean;
  tokens: AuthTokens | null;
  user: User | null;
  organization: Organization | null;
  needsSetup: boolean;
  tosRequired: boolean;
  isInitialized: boolean;
  setTokens: (tokens: AuthTokens) => void;
  setUser: (user: User | null) => void;
  setOrganization: (org: Organization | null) => void;
  setNeedsSetup: (needsSetup: boolean) => void;
  setTosRequired: (tosRequired: boolean) => void;
  clearAuth: () => void;
  initialize: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  tokens: null,
  user: null,
  organization: null,
  needsSetup: false,
  tosRequired: false,
  isInitialized: false,

  setTokens: (tokens: AuthTokens) => {
    localStorage.setItem("accessToken", tokens.accessToken);
    localStorage.setItem("refreshToken", tokens.refreshToken);
    localStorage.setItem("idToken", tokens.idToken);
    set({ tokens, isAuthenticated: true });
  },

  setUser: (user: User | null) => {
    set({ user });
  },

  setOrganization: (organization: Organization | null) => {
    set({ organization });
  },

  setNeedsSetup: (needsSetup: boolean) => {
    set({ needsSetup });
  },

  setTosRequired: (tosRequired: boolean) => {
    set({ tosRequired });
  },

  clearAuth: () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("idToken");
    set({ tokens: null, user: null, organization: null, needsSetup: false, tosRequired: false, isAuthenticated: false });
  },

  initialize: () => {
    const accessToken = localStorage.getItem("accessToken");
    const refreshToken = localStorage.getItem("refreshToken");
    const idToken = localStorage.getItem("idToken");

    if (accessToken && refreshToken && idToken) {
      set({
        tokens: {
          accessToken,
          refreshToken,
          idToken,
          expiresIn: 3600,
        },
        isAuthenticated: true,
        isInitialized: true,
      });
    } else {
      set({ isInitialized: true });
    }
  },

  logout: () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("idToken");
    set({ tokens: null, user: null, organization: null, needsSetup: false, tosRequired: false, isAuthenticated: false });
  },
}));
