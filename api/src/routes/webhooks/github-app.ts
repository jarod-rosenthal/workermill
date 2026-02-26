/**
 * GitHub App Webhook — handles installation lifecycle events.
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../../db/connection.js";
import { Organization } from "../../models/Organization.js";
import { logger } from "../../utils/logger.js";
import { clearInstallationToken } from "../../services/github-app.js";
import { getOrgSecretFromDb } from "../../utils/org-secret-store.js";

const router = Router();

/** Verify GitHub webhook signature (HMAC SHA-256). */
async function verifyWebhookSignature(req: Request): Promise<boolean> {
  const signature = req.headers["x-hub-signature-256"] as string;
  if (!signature) return false;

  // Fetch webhook secret from platform org
  const platformOrg = await Organization.getPlatformOrg();
  if (!platformOrg) return false;

  const secret = await getOrgSecretFromDb(platformOrg.id, "github-app-webhook-secret");
  if (!secret) return false;

  const body = JSON.stringify(req.body);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

router.post("/github-app", async (req: Request, res: Response) => {
  const event = req.headers["x-github-event"] as string;

  if (!(await verifyWebhookSignature(req))) {
    logger.warn("GitHub App webhook: invalid signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const { action, installation } = req.body;
  const installationId = installation?.id;

  if (!installationId) {
    res.status(200).json({ ok: true });
    return;
  }

  if (event === "installation" && (action === "deleted" || action === "suspend")) {
    // Clear installation from org
    const orgRepo = AppDataSource.getRepository(Organization);
    const result = await orgRepo.update(
      { githubAppInstallationId: installationId },
      { githubAppInstallationId: null as unknown as number },
    );

    clearInstallationToken(installationId);

    logger.info("GitHub App uninstalled/suspended", {
      installationId,
      action,
      orgsCleared: result.affected,
    });
  }

  res.status(200).json({ ok: true });
});

export default router;
