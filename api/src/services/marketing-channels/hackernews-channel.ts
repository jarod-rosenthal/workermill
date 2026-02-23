import { logger } from "../../utils/logger.js";
import { MarketingContent } from "../../models/MarketingContent.js";
import type {
  MarketingChannel,
  CampaignMetrics,
  CampaignConfig,
  PublishResult,
} from "./base-channel.js";

export class HackerNewsChannel implements MarketingChannel {
  readonly platform = "hackernews";
  private apiKey: string;

  constructor(credentials: Record<string, unknown>) {
    this.apiKey = credentials.apiKey as string;
  }

  async fetchMetrics(
    externalCampaignId: string,
  ): Promise<CampaignMetrics> {
    logger.info(
      `[HackerNews] Fetching metrics for campaign ${externalCampaignId}`,
    );
    throw new Error("HackerNews API integration not yet configured");
  }

  async publish(content: MarketingContent): Promise<PublishResult> {
    logger.info(
      `[HackerNews] Publishing content: ${content.title || content.body.slice(0, 50)}`,
    );
    throw new Error("HackerNews API integration not yet configured");
  }

  async adjustBid(
    externalCampaignId: string,
    newBidCents: number,
  ): Promise<void> {
    logger.info(
      `[HackerNews] Adjusting bid for ${externalCampaignId} to ${newBidCents}c`,
    );
    throw new Error("HackerNews API integration not yet configured");
  }

  async pauseCampaign(externalCampaignId: string): Promise<void> {
    logger.info(`[HackerNews] Pausing campaign ${externalCampaignId}`);
    throw new Error("HackerNews API integration not yet configured");
  }

  async resumeCampaign(externalCampaignId: string): Promise<void> {
    logger.info(`[HackerNews] Resuming campaign ${externalCampaignId}`);
    throw new Error("HackerNews API integration not yet configured");
  }

  async createCampaign(
    config: CampaignConfig,
  ): Promise<{ externalId: string }> {
    logger.info(`[HackerNews] Creating campaign: ${config.name}`);
    throw new Error("HackerNews API integration not yet configured");
  }

  async validateCredentials(): Promise<boolean> {
    return !!this.apiKey;
  }
}
