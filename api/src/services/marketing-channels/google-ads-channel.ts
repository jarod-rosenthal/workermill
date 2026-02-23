import { logger } from "../../utils/logger.js";
import { MarketingContent } from "../../models/MarketingContent.js";
import type {
  MarketingChannel,
  CampaignMetrics,
  CampaignConfig,
  PublishResult,
} from "./base-channel.js";

export class GoogleAdsChannel implements MarketingChannel {
  readonly platform = "google_ads";
  private apiKey: string;

  constructor(credentials: Record<string, unknown>) {
    this.apiKey = credentials.apiKey as string;
  }

  async fetchMetrics(
    externalCampaignId: string,
  ): Promise<CampaignMetrics> {
    logger.info(
      `[GoogleAds] Fetching metrics for campaign ${externalCampaignId}`,
    );
    throw new Error("GoogleAds API integration not yet configured");
  }

  async publish(content: MarketingContent): Promise<PublishResult> {
    logger.info(
      `[GoogleAds] Publishing content: ${content.title || content.body.slice(0, 50)}`,
    );
    throw new Error("GoogleAds API integration not yet configured");
  }

  async adjustBid(
    externalCampaignId: string,
    newBidCents: number,
  ): Promise<void> {
    logger.info(
      `[GoogleAds] Adjusting bid for ${externalCampaignId} to ${newBidCents}c`,
    );
    throw new Error("GoogleAds API integration not yet configured");
  }

  async pauseCampaign(externalCampaignId: string): Promise<void> {
    logger.info(`[GoogleAds] Pausing campaign ${externalCampaignId}`);
    throw new Error("GoogleAds API integration not yet configured");
  }

  async resumeCampaign(externalCampaignId: string): Promise<void> {
    logger.info(`[GoogleAds] Resuming campaign ${externalCampaignId}`);
    throw new Error("GoogleAds API integration not yet configured");
  }

  async createCampaign(
    config: CampaignConfig,
  ): Promise<{ externalId: string }> {
    logger.info(`[GoogleAds] Creating campaign: ${config.name}`);
    throw new Error("GoogleAds API integration not yet configured");
  }

  async validateCredentials(): Promise<boolean> {
    return !!this.apiKey;
  }
}
