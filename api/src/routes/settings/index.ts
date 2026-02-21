import { Router } from "express";
import { authenticateRequest } from "../../middleware/auth.js";
import { requireCurrentTos } from "../../middleware/tos.js";
import generalRouter from "./general.js";
import integrationsRouter from "./integrations.js";
import modelsRouter from "./models.js";
import webhooksRouter from "./webhooks.js";
import orgRouter from "./org.js";

const router = Router();

// All settings routes require authentication (supports both JWT and API key)
router.use(authenticateRequest);
router.use(requireCurrentTos);

// Core settings (GET /, PUT /, test-email, test-welcome-email, slug)
router.use(generalRouter);

// Integration management (/integrations/*)
router.use("/integrations", integrationsRouter);

// Model discovery and provider management (/models/*, /providers/*)
router.use(modelsRouter);

// Webhook endpoint management (/webhooks/*)
router.use("/webhooks", webhooksRouter);

// Personas, organizations, budget, diagnostics, remote agents
router.use(orgRouter);

export default router;
