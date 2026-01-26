import { create } from "zustand";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  githubRepo: string | null;
  defaultPersona: string;
  defaultModel: string;
  defaultProvider: string;
  taskSequence: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectData {
  key: string;
  name: string;
  description?: string | null;
  githubRepo?: string | null;
  defaultPersona?: string;
  defaultModel?: string;
  defaultProvider?: string;
}

export interface UpdateProjectData {
  name?: string;
  description?: string | null;
  githubRepo?: string | null;
  defaultPersona?: string;
  defaultModel?: string;
  defaultProvider?: string;
  isArchived?: boolean;
}

interface ProjectsState {
  projects: Project[];
  selectedProjectId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchProjects: () => Promise<void>;
  createProject: (data: CreateProjectData) => Promise<Project>;
  updateProject: (id: string, data: UpdateProjectData) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  setSelectedProject: (id: string | null) => void;
  getProjectById: (id: string) => Project | undefined;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch projects");
      }

      const data = await response.json();
      set({ projects: data.projects, isLoading: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch projects";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  createProject: async (data: CreateProjectData) => {
    set({ isLoading: true, error: null });
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create project");
      }

      const responseData = await response.json();
      const newProject = responseData.project;
      set((state) => ({
        projects: [...state.projects, newProject],
        isLoading: false,
      }));
      return newProject;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create project";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  updateProject: async (id: string, data: UpdateProjectData) => {
    set({ isLoading: true, error: null });
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update project");
      }

      const responseData = await response.json();
      const updatedProject = responseData.project;
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? updatedProject : p
        ),
        isLoading: false,
      }));
      return updatedProject;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update project";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deleteProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete project");
      }

      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        selectedProjectId:
          state.selectedProjectId === id ? null : state.selectedProjectId,
        isLoading: false,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete project";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  setSelectedProject: (id: string | null) => {
    set({ selectedProjectId: id });
  },

  getProjectById: (id: string) => {
    return get().projects.find((p) => p.id === id);
  },
}));
