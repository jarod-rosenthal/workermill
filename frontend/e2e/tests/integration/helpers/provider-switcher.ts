import type { APIRequestContext } from "@playwright/test";

const API_URL = "http://localhost:3001";

export class ProviderSwitcher {
  private request: APIRequestContext;
  private original: Record<string, unknown> = {};
  private saved = false;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async saveOriginal(): Promise<void> {
    const response = await this.request.get(`${API_URL}/api/settings`);
    if (!response.ok()) throw new Error("Failed to fetch settings for save");
    this.original = await response.json();
    this.saved = true;
  }

  async switchAIProvider(provider: string, model: string): Promise<void> {
    if (!this.saved) await this.saveOriginal();
    await this.updateSettings({
      primaryProvider: provider,
      defaultWorkerModel: model,
      planningAgentProvider: provider,
      planningAgentModel: model,
      managerProvider: provider,
      managerModelId: model,
    });
  }

  async switchSCMProvider(provider: string): Promise<void> {
    if (!this.saved) await this.saveOriginal();
    await this.updateSettings({ scmProvider: provider });
  }

  async switchTicketSystem(provider: string): Promise<void> {
    if (!this.saved) await this.saveOriginal();
    await this.updateSettings({ issueTrackerProvider: provider });
  }

  async restore(): Promise<void> {
    if (!this.saved) return;
    await this.updateSettings({
      primaryProvider: this.original.primaryProvider,
      defaultWorkerModel: this.original.defaultWorkerModel,
      planningAgentProvider: this.original.planningAgentProvider,
      planningAgentModel: this.original.planningAgentModel,
      managerProvider: this.original.managerProvider,
      managerModelId: this.original.managerModelId,
      scmProvider: this.original.scmProvider,
      issueTrackerProvider: this.original.issueTrackerProvider,
    });
  }

  private async updateSettings(fields: Record<string, unknown>): Promise<void> {
    const response = await this.request.put(`${API_URL}/api/settings`, {
      data: fields,
    });
    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`Failed to update settings: ${response.status()} ${body}`);
    }
  }
}
