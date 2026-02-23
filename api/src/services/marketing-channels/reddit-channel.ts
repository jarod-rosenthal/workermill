import { logger } from "../../utils/logger.js";
import { MarketingContent } from "../../models/MarketingContent.js";
import type {
  MarketingChannel,
  CampaignMetrics,
  CampaignConfig,
  PublishResult,
} from "./base-channel.js";

export class RedditChannel implements MarketingChannel {
  readonly platform = "reddit";
  private apiKey: string;

  constructor(credentials: Record<string, unknown>) {
    this.apiKey = credentials.apiKey as string;
  }

  async fetchMetrics(
    externalCampaignId: string,
  ): Promise<CampaignMetrics> {
    logger.info(
      `[Reddit] Fetching metrics for campaign ${externalCampaignId}`,
    );
    throw new Error("Reddit API integration not yet configured");
  }

  async publish(content: MarketingContent): Promise<PublishResult> {
    logger.info(
      `[Reddit] Publishing content: ${content.title || content.body.slice(0, 50)}`,
    );
    throw new Error("Reddit API integration not yet configured");
  }

  async adjustBid(
    externalCampaignId: string,
    newBidCents: number,
  ): Promise<void> {
    logger.info(
      `[Reddit] Adjusting bid for ${externalCampaignId} to ${newBidCents}c`,
    );
    throw new Error("Reddit API integration not yet configured");
  }

  async pauseCampaign(externalCampaignId: string): Promise<void> {
    logger.info(`[Reddit] Pausing campaign ${externalCampaignId}`);
    throw new Error("Reddit API integration not yet configured");
  }

  async resumeCampaign(externalCampaignId: string): Promise<void> {
    logger.info(`[Reddit] Resuming campaign ${externalCampaignId}`);
    throw new Error("Reddit API integration not yet configured");
  }

  async createCampaign(
    config: CampaignConfig,
  ): Promise<{ externalId: string }> {
    logger.info(`[Reddit] Creating campaign: ${config.name}`);
    throw new Error("Reddit API integration not yet configured");
  }

  async validateCredentials(): Promise<boolean> {
    return !!this.apiKey;
  }
}
