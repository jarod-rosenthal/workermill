import { Router, Request, Response } from "express";
import { requireAdmin } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import {
  hasProviderCredentials,
  clearProviderCredentialsCache,
} from "../../config/index.js";
import {
  listProviders,
  getProvider,
  hasProvider,
} from "../../providers/index.js";
import { isValidProviderId, type ProviderId } from "../../providers/types.js";
import {
  PLAN_FEATURES,
  type OrganizationPlan,
} from "../../models/index.js";
import {
  getAvailableModels,
  getOrgSecret,
  saveOrgSecret,
  deleteOrgSecret,
  modelCache,
  testAnthropicApiKey,
  testOpenAIApiKey,
  testGoogleApiKey,
} from "./helpers.js";

const router = Router();

/**
 * GET /api/settings/models
 * Get all available models from all providers (with dynamic Ollama discovery)
 */
router.get("/models", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const result = await getAvailableModels(org);

    res.json({
      models: result.models,
      ollamaStatus: result.ollamaStatus,
      ollamaHost: org.ollamaBaseUrl || process.env.OLLAMA_HOST || null,
    });
  } catch (error) {
    logger.error("Error fetching available models", { error });
    res.status(500).json({ error: "Failed to fetch available models" });
  }
});

/**
 * POST /api/settings/models/refresh
 * Force refresh the model cache (clears cache and re-discovers)
 */
router.post("/models/refresh", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const cacheKey = `models-${org.id}`;

    // Clear cache
    modelCache.delete(cacheKey);

    // Re-discover
    const result = await getAvailableModels(org);

    logger.info("Model cache refreshed", { orgId: org.id, modelCount: result.models.length });

    res.json({
      models: result.models,
      ollamaStatus: result.ollamaStatus,
      ollamaHost: org.ollamaBaseUrl || process.env.OLLAMA_HOST || null,
      refreshed: true,
    });
  } catch (error) {
    logger.error("Error refreshing models", { error });
    res.status(500).json({ error: "Failed to refresh models" });
  }
});

// =============================================================================
// Provider Management Endpoints
// =============================================================================

/**
 * GET /api/settings/providers
 * List all available providers with their configuration status
 */
router.get("/providers", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const providers = listProviders();

    // Check credentials status for each provider
    const providerStatuses = await Promise.all(
      providers.map(async (provider) => {
        const hasCredentials = await hasProviderCredentials(
          org.id,
          provider.id as ProviderId
        );

        return {
          id: provider.id,
          name: provider.name,
          defaultModel: provider.defaultModel,
          requiresApiKey: provider.requiresApiKey,
          configured: hasCredentials,
          models: provider.pricingEngine.getModels().map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tier: m.tier,
            contextWindow: m.contextWindow,
          })),
        };
      })
    );

    res.json({
      providers: providerStatuses,
      primaryProvider: org.primaryProvider || "anthropic",
    });
  } catch (error) {
    logger.error("Error listing providers", { error });
    res.status(500).json({ error: "Failed to list providers" });
  }
});

/**
 * POST /api/settings/providers/:providerId/test
 * Test provider credentials by making a simple API call
 */
router.post("/providers/:providerId/test", async (req: Request, res: Response) => {
  try {
    const providerId = req.params.providerId as string;
    const org = req.organization!;

    if (!isValidProviderId(providerId)) {
      res.status(400).json({ error: `Invalid provider ID: ${providerId}` });
      return;
    }

    // Block non-Anthropic providers on Pro plan
    if (providerId !== "anthropic") {
      const features =
        PLAN_FEATURES[org.plan as OrganizationPlan] ?? PLAN_FEATURES.pro;
      if (!features.multiProvider) {
        res.status(403).json({
          error:
            "Pro plan only supports Anthropic Claude. Upgrade to Max for all AI providers.",
        });
        return;
      }
    }

    if (!hasProvider(providerId)) {
      res.status(404).json({ error: `Provider not found: ${providerId}` });
      return;
    }

    const provider = getProvider(providerId);

    // For Ollama, just check if the host is reachable
    if (providerId === "ollama") {
      const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
      try {
        const response = await fetch(`${ollamaHost}/api/tags`, {
          method: "GET",
        });
        if (response.ok) {
          res.json({
            success: true,
            message: "Ollama connection successful",
            host: ollamaHost,
          });
        } else {
          res.status(400).json({ error: `Ollama not reachable at ${ollamaHost}` });
        }
      } catch {
        res.status(400).json({ error: `Ollama not reachable at ${ollamaHost}` });
      }
      return;
    }

    // SECURITY: Only test org-specific credentials - NO platform fallback for multi-tenancy isolation
    const apiKey = await getOrgSecret(org.id, `providers/${providerId}`);

    if (!apiKey) {
      res.status(400).json({
        error: `${provider.name} API key not configured for your organization`,
        configured: false,
        hint: "Please add your API key in Settings > AI Providers",
      });
      return;
    }

    // Test the API key based on provider
    let testResult: { success: boolean; message: string; details?: unknown };

    switch (providerId) {
      case "anthropic":
        testResult = await testAnthropicApiKey(apiKey);
        break;
      case "openai":
        testResult = await testOpenAIApiKey(apiKey);
        break;
      case "google":
        testResult = await testGoogleApiKey(apiKey);
        break;
      default:
        testResult = { success: false, message: `Testing not implemented for ${providerId}` };
    }

    if (testResult.success) {
      res.json(testResult);
    } else {
      res.status(400).json(testResult);
    }
  } catch (error) {
    logger.error("Error testing provider credentials", { error });
    res.status(500).json({ error: "Failed to test provider credentials" });
  }
});

/**
 * PUT /api/settings/providers/:providerId/credentials
 * Save provider credentials to Secrets Manager
 */
router.put(
  "/providers/:providerId/credentials",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const providerId = req.params.providerId as string;
      const { apiKey } = req.body;
      const org = req.organization!;

      if (!isValidProviderId(providerId)) {
        res.status(400).json({ error: `Invalid provider ID: ${providerId}` });
        return;
      }

      // Block non-Anthropic providers on Pro plan
      if (providerId !== "anthropic") {
        const features =
          PLAN_FEATURES[org.plan as OrganizationPlan] ?? PLAN_FEATURES.pro;
        if (!features.multiProvider) {
          res.status(403).json({
            error:
              "Pro plan only supports Anthropic Claude. Upgrade to Max for all AI providers.",
          });
          return;
        }
      }

      if (!hasProvider(providerId)) {
        res.status(404).json({ error: `Provider not found: ${providerId}` });
        return;
      }

      const provider = getProvider(providerId);

      // Ollama doesn't need credentials
      if (providerId === "ollama") {
        res.json({
          success: true,
          message: "Ollama does not require API credentials",
        });
        return;
      }

      if (!apiKey) {
        res.status(400).json({ error: "Missing required field: apiKey" });
        return;
      }

      // Save to org-specific secret store
      await saveOrgSecret(org.id, `providers/${providerId}`, apiKey);

      // Clear the credentials cache for this org/provider
      clearProviderCredentialsCache(org.id, providerId as ProviderId);

      logger.info("Provider credentials updated", {
        orgId: org.id,
        providerId,
      });

      res.json({
        success: true,
        message: `${provider.name} credentials saved successfully`,
      });
    } catch (error) {
      logger.error("Error saving provider credentials", { error });
      res.status(500).json({ error: "Failed to save provider credentials" });
    }
  }
);

/**
 * DELETE /api/settings/providers/:providerId/credentials
 * Remove provider credentials from Secrets Manager
 */
router.delete(
  "/providers/:providerId/credentials",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const providerId = req.params.providerId as string;
      const org = req.organization!;

      if (!isValidProviderId(providerId)) {
        res.status(400).json({ error: `Invalid provider ID: ${providerId}` });
        return;
      }

      // Don't allow deleting anthropic credentials (platform default)
      if (providerId === "anthropic") {
        res.status(400).json({
          error: "Cannot delete Anthropic credentials. This is the platform default provider.",
        });
        return;
      }

      await deleteOrgSecret(org.id, `providers/${providerId}`);

      // Clear the credentials cache
      clearProviderCredentialsCache(org.id, providerId as ProviderId);

      logger.info("Provider credentials removed", {
        orgId: org.id,
        providerId,
      });

      res.json({
        success: true,
        message: `${providerId} credentials removed successfully`,
      });
    } catch (error) {
      logger.error("Error removing provider credentials", { error });
      res.status(500).json({ error: "Failed to remove provider credentials" });
    }
  }
);

export default router;
