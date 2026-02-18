/**
 * Webhook Service
 *
 * Centralized webhook verification and org resolution for multi-tenant isolation.
 * Provides URL-based tenant routing and per-org webhook secrets.
 */

import crypto from "crypto";
import { AppDataSource } from "../db/connection.js";
import { Organization, WebhookEndpoint, type IntegrationType } from "../models/index.js";
import { logger } from "../utils/logger.js";

export interface WebhookContext {
  org: Organization;
  endpoint: WebhookEndpoint;
}

export interface WebhookVerificationResult {
  success: boolean;
  context?: WebhookContext;
  error?: string;
  statusCode?: number;
}

/**
 * Verify webhook signature using HMAC-SHA256
 */
export function verifyHmacSignature(
  payload: string,
  signature: string | undefined,
  secret: string,
  prefix: string = "sha256="
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature =
    prefix + crypto.createHmac("sha256", secret).update(payload).digest("hex");

  // Handle both formats: with or without prefix
  const normalizedSignature = signature.startsWith(prefix)
    ? signature
    : `${prefix}${signature}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(normalizedSignature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}

/**
 * Verify webhook using org slug and integration type (URL-based routing)
 *
 * This is the recommended approach for multi-tenant webhook handling.
 * URL format: /api/webhooks/:orgSlug/:integration
 */
export async function verifyWebhookBySlug(
  orgSlug: string,
  integrationType: IntegrationType,
  rawBody: string,
  signature: string | undefined,
  signatureHeader: string = "x-hub-signature"
): Promise<WebhookVerificationResult> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const endpointRepo = AppDataSource.getRepository(WebhookEndpoint);

  // Use a generic error for all verification failures to prevent org enumeration.
  // Attackers must not be able to distinguish "org doesn't exist" from "bad signature".
  const genericFailure: WebhookVerificationResult = {
    success: false,
    error: "Webhook verification failed",
    statusCode: 404,
  };

  // 1. Find org by slug
  const org = await orgRepo.findOne({ where: { slug: orgSlug } });
  if (!org) {
    logger.warn("Webhook org not found by slug", { orgSlug, integrationType });
    return genericFailure;
  }

  // 2. Get webhook endpoint config for this org + integration
  const endpoint = await endpointRepo.findOne({
    where: { orgId: org.id, integrationType, isActive: true },
  });

  if (!endpoint) {
    logger.warn("Webhook endpoint not configured", {
      orgId: org.id,
      orgSlug,
      integrationType,
    });
    return genericFailure;
  }

  // 3. Verify signature (unless explicitly disabled for testing)
  if (endpoint.shouldVerifySignature()) {
    // Determine signature prefix based on integration type
    const prefix = integrationType === "gitlab" ? "" : "sha256=";

    // GitLab uses x-gitlab-token header (plain token match, not HMAC)
    if (integrationType === "gitlab") {
      if (signature !== endpoint.webhookSecret) {
        logger.warn("Invalid GitLab webhook token", {
          orgId: org.id,
          orgSlug,
          integrationType,
        });
        return genericFailure;
      }
    } else {
      // Use HMAC verification for Jira, GitHub, Linear, BitBucket, Email
      if (!verifyHmacSignature(rawBody, signature, endpoint.webhookSecret, prefix)) {
        logger.warn("Invalid webhook signature", {
          orgId: org.id,
          orgSlug,
          integrationType,
          signatureHeader,
          receivedSignaturePrefix: signature?.substring(0, 20) + "...",
        });
        return genericFailure;
      }
    }
  }

  // 4. Update last received timestamp
  await endpointRepo.update(endpoint.id, { lastReceivedAt: new Date() });

  logger.info("Webhook verified successfully", {
    orgId: org.id,
    orgSlug,
    integrationType,
    endpointId: endpoint.id,
  });

  return {
    success: true,
    context: { org, endpoint },
  };
}

/**
 * Get the appropriate signature header value based on integration type
 */
export function getSignatureFromHeaders(
  headers: Record<string, string | string[] | undefined> | NodeJS.Dict<string | string[]>,
  integrationType: IntegrationType
): string | undefined {
  const headerMap: Record<IntegrationType, string[]> = {
    jira: ["x-hub-signature", "x-atlassian-webhook-signature"],
    github: ["x-hub-signature-256"],
    "github-issues": ["x-hub-signature-256"],
    gitlab: ["x-gitlab-token"],
    bitbucket: ["x-hub-signature"],
    linear: ["linear-signature"],
    email: ["x-email-signature"],
  };

  const headerNames = headerMap[integrationType] || [];
  for (const name of headerNames) {
    const value = headers[name];
    if (value) {
      const result = Array.isArray(value) ? value[0] : value;
      return result as string;
    }
  }
  return undefined;
}

/**
 * Get delivery ID from headers for idempotency
 */
export function getDeliveryIdFromHeaders(
  headers: Record<string, string | string[] | undefined> | NodeJS.Dict<string | string[]>,
  integrationType: IntegrationType,
  body?: Record<string, unknown>
): string | undefined {
  const headerMap: Record<IntegrationType, string[]> = {
    jira: ["x-atlassian-webhook-id"],
    github: ["x-github-delivery"],
    "github-issues": ["x-github-delivery"],
    gitlab: ["x-gitlab-delivery"],
    bitbucket: ["x-request-uuid"],
    linear: ["x-linear-delivery", "linear-delivery"],
    email: ["x-email-message-id"],
  };

  const headerNames = headerMap[integrationType] || [];
  for (const name of headerNames) {
    const value = headers[name];
    if (value) {
      const result = Array.isArray(value) ? value[0] : value;
      return result as string;
    }
  }

  // Fallback for GitLab: use object_attributes.id
  if (integrationType === "gitlab" && body?.object_attributes) {
    const attrs = body.object_attributes as Record<string, unknown>;
    if (attrs.id) {
      return String(attrs.id);
    }
  }

  return undefined;
}

/**
 * Generate a new webhook secret
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Create or update webhook endpoint for an org
 */
export async function ensureWebhookEndpoint(
  orgId: string,
  integrationType: IntegrationType,
  secret?: string
): Promise<WebhookEndpoint> {
  const repo = AppDataSource.getRepository(WebhookEndpoint);

  let endpoint = await repo.findOne({
    where: { orgId, integrationType },
  });

  if (!endpoint) {
    endpoint = repo.create({
      orgId,
      integrationType,
      webhookSecret: secret || generateWebhookSecret(),
      isActive: true,
      config: {},
    });
    await repo.save(endpoint);
    logger.info("Created webhook endpoint", { orgId, integrationType });
  } else if (secret && secret !== endpoint.webhookSecret) {
    endpoint.webhookSecret = secret;
    await repo.save(endpoint);
    logger.info("Updated webhook endpoint secret", { orgId, integrationType });
  }

  return endpoint;
}

/**
 * Get all webhook endpoints for an org with URLs
 */
export async function getWebhookEndpointsWithUrls(
  orgId: string,
  baseUrl: string
): Promise<Array<{
  integrationType: IntegrationType;
  webhookUrl: string;
  isActive: boolean;
  lastReceivedAt: Date | null;
  hasSecret: boolean;
}>> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const endpointRepo = AppDataSource.getRepository(WebhookEndpoint);

  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org || !org.slug) {
    return [];
  }

  const endpoints = await endpointRepo.find({
    where: { orgId },
    order: { integrationType: "ASC" },
  });

  return endpoints.map((ep) => ({
    integrationType: ep.integrationType,
    webhookUrl: ep.getWebhookUrl(baseUrl, org.slug!),
    isActive: ep.isActive,
    lastReceivedAt: ep.lastReceivedAt,
    hasSecret: !!ep.webhookSecret,
  }));
}
