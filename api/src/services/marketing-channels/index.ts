import type { MarketingChannel } from "./base-channel.js";
import { GoogleAdsChannel } from "./google-ads-channel.js";
import { RedditChannel } from "./reddit-channel.js";
import { XChannel } from "./x-channel.js";
import { DevtoChannel } from "./devto-channel.js";
import { HackerNewsChannel } from "./hackernews-channel.js";

export type {
  MarketingChannel,
  CampaignMetrics,
  CampaignConfig,
  PublishResult,
} from "./base-channel.js";

const CHANNEL_MAP: Record<
  string,
  new (credentials: Record<string, unknown>) => MarketingChannel
> = {
  google_ads: GoogleAdsChannel,
  reddit: RedditChannel,
  x: XChannel,
  devto: DevtoChannel,
  hackernews: HackerNewsChannel,
};

export function getEnabledChannels(
  channelCredentials: Record<string, Record<string, unknown>>,
): MarketingChannel[] {
  const channels: MarketingChannel[] = [];
  for (const [platform, creds] of Object.entries(channelCredentials)) {
    if (!creds.enabled) continue;
    const ChannelClass = CHANNEL_MAP[platform];
    if (ChannelClass) {
      channels.push(new ChannelClass(creds));
    }
  }
  return channels;
}
