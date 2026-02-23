import { MarketingContent } from "../../models/MarketingContent.js";

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  spentCents: number;
  ctr: number;
  cpa: number;
}

export interface CampaignConfig {
  name: string;
  budgetCents: number;
  targetingConfig: Record<string, unknown>;
  bidStrategyCpc?: number;
  bidStrategyCpm?: number;
}

export interface PublishResult {
  externalId: string;
  url?: string;
}

export interface MarketingChannel {
  readonly platform: string;
  fetchMetrics(externalCampaignId: string): Promise<CampaignMetrics>;
  publish(content: MarketingContent): Promise<PublishResult>;
  adjustBid(externalCampaignId: string, newBidCents: number): Promise<void>;
  pauseCampaign(externalCampaignId: string): Promise<void>;
  resumeCampaign(externalCampaignId: string): Promise<void>;
  createCampaign(config: CampaignConfig): Promise<{ externalId: string }>;
  validateCredentials(): Promise<boolean>;
}
