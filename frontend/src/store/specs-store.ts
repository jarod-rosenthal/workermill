import { create } from "zustand";
import type {
  Spec,
  QualityFeedback,
  SpecTemplate,
  SpecVersion,
  CreateSpecData,
  UpdateSpecData,
} from "../lib/specs-api";
import * as specsApi from "../lib/specs-api";

interface SpecsState {
  specs: Spec[];
  currentSpec: Spec | null;
  templates: SpecTemplate[];
  versions: SpecVersion[];
  isLoading: boolean;
  isScoring: boolean;
  isImproving: boolean;
  error: string | null;

  fetchSpecs: (params?: {
    status?: string;
    templateId?: string;
  }) => Promise<void>;
  fetchSpec: (specId: string) => Promise<void>;
  createSpec: (data: CreateSpecData) => Promise<Spec>;
  updateSpec: (specId: string, data: UpdateSpecData) => Promise<void>;
  deleteSpec: (specId: string) => Promise<void>;
  scoreSpec: (specId: string) => Promise<QualityFeedback>;
  improveSpec: (specId: string) => Promise<void>;
  fetchVersions: (specId: string) => Promise<void>;
  fetchTemplates: () => Promise<void>;

  setCurrentSpec: (spec: Spec | null) => void;
  clearError: () => void;
}

export const useSpecsStore = create<SpecsState>((set) => ({
  specs: [],
  currentSpec: null,
  templates: [],
  versions: [],
  isLoading: false,
  isScoring: false,
  isImproving: false,
  error: null,

  fetchSpecs: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const specs = await specsApi.getSpecs(params);
      set({ specs, isLoading: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch specs";
      set({ error: message, isLoading: false });
    }
  },

  fetchSpec: async (specId) => {
    set({ isLoading: true, error: null });
    try {
      const spec = await specsApi.getSpec(specId);
      set({ currentSpec: spec, isLoading: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch spec";
      set({ error: message, isLoading: false });
    }
  },

  createSpec: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const spec = await specsApi.createSpec(data);
      set((state) => ({ specs: [spec, ...state.specs], isLoading: false }));
      return spec;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create spec";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  updateSpec: async (specId, data) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await specsApi.updateSpec(specId, data);
      set((state) => ({
        specs: state.specs.map((s) => (s.id === specId ? updated : s)),
        currentSpec:
          state.currentSpec?.id === specId ? updated : state.currentSpec,
        isLoading: false,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update spec";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deleteSpec: async (specId) => {
    set({ isLoading: true, error: null });
    try {
      await specsApi.deleteSpec(specId);
      set((state) => ({
        specs: state.specs.filter((s) => s.id !== specId),
        currentSpec:
          state.currentSpec?.id === specId ? null : state.currentSpec,
        isLoading: false,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete spec";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  scoreSpec: async (specId) => {
    set({ isScoring: true, error: null });
    try {
      const feedback = await specsApi.scoreSpec(specId);
      const spec = await specsApi.getSpec(specId);
      set((state) => ({
        specs: state.specs.map((s) => (s.id === specId ? spec : s)),
        currentSpec:
          state.currentSpec?.id === specId ? spec : state.currentSpec,
        isScoring: false,
      }));
      return feedback;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to score spec";
      set({ error: message, isScoring: false });
      throw error;
    }
  },

  improveSpec: async (specId) => {
    set({ isImproving: true });
    try {
      const updated = await specsApi.improveSpec(specId);
      set((state) => ({
        specs: state.specs.map((s) => (s.id === specId ? updated : s)),
        currentSpec:
          state.currentSpec?.id === specId ? updated : state.currentSpec,
      }));
    } finally {
      set({ isImproving: false });
    }
  },

  fetchVersions: async (specId) => {
    try {
      const versions = await specsApi.getSpecVersions(specId);
      set({ versions });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch versions";
      set({ error: message });
    }
  },

  fetchTemplates: async () => {
    try {
      const templates = await specsApi.getSpecTemplates();
      set({ templates });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch templates";
      set({ error: message });
    }
  },

  setCurrentSpec: (spec) => set({ currentSpec: spec }),
  clearError: () => set({ error: null }),
}));
