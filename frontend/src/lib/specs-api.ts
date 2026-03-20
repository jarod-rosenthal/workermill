import apiClient from "./api-client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface QualityDimensionScore {
  score: number;
  feedback: string;
}

export interface QualityFeedback {
  overall: number;
  dimensions: {
    completeness: QualityDimensionScore;
    clarity: QualityDimensionScore;
    decomposability: QualityDimensionScore;
    constraints: QualityDimensionScore;
    testability: QualityDimensionScore;
  };
  suggestions: string[];
}

export interface Spec {
  id: string;
  orgId: string;
  title: string;
  content: string | null;
  status: "draft" | "validated" | "decomposed" | "archived";
  qualityScore: number | null;
  qualityFeedback: QualityFeedback | null;
  templateId: string | null;
  version: number;
  createdBy: string | null;
  boardId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SpecTemplate {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  content: string;
  requiredSections: string[];
  isDefault: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpecVersion {
  id: string;
  specId: string;
  content: string;
  qualityScore: number | null;
  version: number;
  createdAt: string;
}

export interface CreateSpecData {
  title: string;
  content?: string;
  templateId?: string;
}

export interface UpdateSpecData {
  title?: string;
  content?: string;
}

// ── API Methods ────────────────────────────────────────────────────────────

export async function getSpecs(params?: {
  status?: string;
  templateId?: string;
}): Promise<Spec[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.templateId) searchParams.set("templateId", params.templateId);
  const qs = searchParams.toString();
  const response = await apiClient.get(`/specs${qs ? `?${qs}` : ""}`);
  return response.data.specs;
}

export async function getSpec(specId: string): Promise<Spec> {
  const response = await apiClient.get(`/specs/${specId}`);
  return response.data.spec;
}

export async function createSpec(data: CreateSpecData): Promise<Spec> {
  const response = await apiClient.post("/specs", data);
  return response.data.spec;
}

export async function updateSpec(
  specId: string,
  data: UpdateSpecData,
): Promise<Spec> {
  const response = await apiClient.put(`/specs/${specId}`, data);
  return response.data.spec;
}

export async function deleteSpec(specId: string): Promise<void> {
  await apiClient.delete(`/specs/${specId}`);
}

export async function scoreSpec(specId: string): Promise<QualityFeedback> {
  const response = await apiClient.post(`/specs/${specId}/score`);
  return response.data.spec?.qualityFeedback ?? response.data;
}

export async function improveSpec(specId: string): Promise<Spec> {
  const response = await apiClient.post(`/specs/${specId}/improve`);
  return response.data.spec;
}

export async function getSpecVersions(
  specId: string,
): Promise<SpecVersion[]> {
  const response = await apiClient.get(`/specs/${specId}/versions`);
  return response.data.versions;
}

export async function getSpecTemplates(): Promise<SpecTemplate[]> {
  const response = await apiClient.get("/specs/templates/list");
  return response.data.templates;
}

export async function createSpecTemplate(data: {
  name: string;
  content: string;
  description?: string;
  requiredSections?: string[];
  isDefault?: boolean;
}): Promise<SpecTemplate> {
  const response = await apiClient.post("/specs/templates", data);
  return response.data.template;
}
