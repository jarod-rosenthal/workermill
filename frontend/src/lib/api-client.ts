import axios from "axios";

const API_BASE_URL = "/api";

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

// Response interceptor to handle 401 errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("idToken");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: async (data: { email: string; password: string }) => {
    const response = await apiClient.post("/auth/login", data);
    return response.data;
  },

  signup: async (data: {
    email: string;
    password: string;
    name: string;
    organizationName: string;
  }) => {
    const response = await apiClient.post("/auth/signup", data);
    return response.data as {
      message: string;
      user: { id: string; email: string; name: string };
      organization: { id: string; name: string };
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

export default apiClient;
