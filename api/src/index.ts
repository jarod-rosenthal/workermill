// Load .env file for local development
import "dotenv/config";

import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import swaggerUi from "swagger-ui-express";

// Initialize Sentry for error tracking (only if DSN is configured)
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: 0.1, // 10% of transactions
  enabled: !!process.env.SENTRY_DSN,
});
import { config, validateEnvironment } from "./config/index.js";
import { AppDataSource } from "./db/connection.js";
import { logger } from "./utils/logger.js";
import { swaggerSpec } from "./config/swagger.js";
import {
  healthRouter,
  authRouter,
  profileRouter,
  tasksRouter,
  tasksV2Router,
  webhooksRouter,
  organizationsRouter,
  inviteRouter,
  controlCenterRouter,
  systemRouter,
  watcherRouter,
  orchestratorRouter,
  managerRouter,
  settingsRouter,
  coordinationRouter,
  billingRouter,
  analyticsRouter,
  auditRouter,
  personasRouter,
  projectsRouter,
  emailRouter,
  warmPoolRouter,
  referralsRouter,
  supportRouter,
  qualityBackfillRouter,
  memoryRouter,
  complianceRouter,
  codebaseRouter,
  directivesRouter,
  managementRouter,
  marketingRouter,
  statusRouter,
  workerDecisionsRouter,
  buildRouter,
  showcaseRouter,
  remoteAgentRouter,
  boardsRouter,
  issuesRouter,
  prdRouter,
  specsRouter,
  attachmentsRouter,
  pushRouter,
} from "./routes/index.js";
import {
  webhookLimiter,
  authenticatedLimiter,
  strictLimiter,
  workerLogLimiter,
} from "./middleware/rate-limit.js";
import {
  verifyWebhookSignature,
  handleCheckoutSessionCompleted,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from "./services/billing.js";
import {
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
  handleSetupIntentSucceeded,
  handlePaymentMethodDetached,
  handleChargeRefunded,
} from "./services/credit-billing.js";
import { startOrchestrator, stopOrchestrator } from "./services/orchestrator.js";
import { redis } from "./services/redis-client.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { poolHealthMiddleware } from "./middleware/pool-health.js";
import { seedDirectivesIfMissing } from "./db/seed-directives-startup.js";
import { seedScriptsIfMissing } from "./db/seed-scripts-startup.js";
import { seedLocalModeIfNeeded } from "./db/seed-local-startup.js";
import { initializeEncryption } from "./utils/encryption.js";
import { activeOps } from "./services/orchestrator-utils.js";
import { stopPoolMonitor } from "./db/connection.js";

// Production guard: EXECUTION_MODE=local must NEVER run in production
if (process.env.EXECUTION_MODE === "local" && process.env.NODE_ENV === "production") {
  console.error("FATAL: EXECUTION_MODE=local is not allowed in production");
  process.exit(1);
}

const app = express();

// Trust one level of proxy (AWS ALB) so req.ip returns the real client IP
app.set("trust proxy", 1);

// Response compression middleware - reduces payload sizes
app.use(
  compression({
    filter: (req, res) => {
      // Don't compress SSE streams (they need real-time delivery)
      if (req.headers.accept?.includes("text/event-stream")) {
        return false;
      }
      return compression.filter(req, res);
    },
    threshold: 1024, // Only compress responses > 1KB
  })
);

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.EXECUTION_MODE === "local" ? true : config.corsOrigins,
    credentials: true,
  })
);

// Pool health gating — 503 when pool exhausted (before routes)
app.use(poolHealthMiddleware);

// Stripe webhook needs raw body - must be before json body parser
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"] as string;
    const webhookSecret = config.stripe?.webhookSecret;

    if (!webhookSecret) {
      logger.error("Stripe webhook secret not configured");
      res.status(500).json({ error: "Webhook not configured" });
      return;
    }

    let event;
    try {
      event = verifyWebhookSignature(req.body, signature, webhookSecret);
    } catch (error) {
      logger.error("Stripe webhook signature verification failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    logger.info("Stripe webhook received", { type: event.type, id: event.id });

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutSessionCompleted(event.data.object);
          break;
        case "customer.subscription.created":
          await handleSubscriptionCreated(event.data.object);
          break;
        case "customer.subscription.updated":
          await handleSubscriptionUpdated(event.data.object);
          break;
        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(event.data.object);
          break;
        case "invoice.paid":
          await handleInvoicePaid(event.data.object);
          break;
        case "invoice.payment_failed":
          await handleInvoicePaymentFailed(event.data.object);
          break;
        // Credit billing webhook events
        case "payment_intent.succeeded":
          await handlePaymentIntentSucceeded(event.data.object as unknown as Parameters<typeof handlePaymentIntentSucceeded>[0]);
          break;
        case "payment_intent.payment_failed":
          await handlePaymentIntentFailed(event.data.object as unknown as Parameters<typeof handlePaymentIntentFailed>[0]);
          break;
        case "setup_intent.succeeded":
          await handleSetupIntentSucceeded(event.data.object as unknown as Parameters<typeof handleSetupIntentSucceeded>[0]);
          break;
        case "payment_method.detached":
          await handlePaymentMethodDetached(event.data.object as unknown as Parameters<typeof handlePaymentMethodDetached>[0]);
          break;
        case "charge.refunded":
          await handleChargeRefunded(event.data.object as unknown as Parameters<typeof handleChargeRefunded>[0]);
          break;
        default:
          logger.debug("Unhandled Stripe event type", { type: event.type });
      }
      res.json({ received: true });
    } catch (error) {
      logger.error("Error processing Stripe webhook", {
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

// Body parsing - capture raw body for webhook signature verification
app.use(
  express.json({
    limit: "10mb",
    verify: (req: express.Request, _res, buf) => {
      // Store raw body for webhook signature verification
      if (req.path.startsWith("/api/webhooks/")) {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  logger.info("Request", {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// API Documentation (Swagger UI) — disabled in production to avoid exposing API surface
if (process.env.NODE_ENV !== "production") {
  app.use(
    "/api/docs",
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      helmet({
        contentSecurityPolicy: false,
      })(req, res, next);
    },
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "WorkerMill API Documentation",
    })
  );

  app.get("/api/docs.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
}

// Routes
app.use("/health", healthRouter);

// Public status endpoint with webhook-level rate limiting (100 req/min)
app.use("/api/status", webhookLimiter, statusRouter);

// Auth routes with strict rate limiting (sensitive operations)
app.use("/api/auth", strictLimiter, authRouter);

// Authenticated routes with standard rate limiting
app.use("/api/profile", authenticatedLimiter, profileRouter);
app.use("/api/push", authenticatedLimiter, pushRouter);
app.use("/api/organizations", authenticatedLimiter, organizationsRouter);
app.use("/api/invites", authenticatedLimiter, inviteRouter);
app.use("/api/control-center", authenticatedLimiter, controlCenterRouter);
app.use("/api/system", authenticatedLimiter, systemRouter);
app.use("/api/watcher", authenticatedLimiter, watcherRouter);
app.use("/api/orchestrator", authenticatedLimiter, orchestratorRouter);
app.use("/api/manager", authenticatedLimiter, managerRouter);
app.use("/api/settings", authenticatedLimiter, settingsRouter);
app.use("/api/coordination", workerLogLimiter, coordinationRouter);
app.use("/api/warm-pool", workerLogLimiter, warmPoolRouter);
app.use("/api/billing", authenticatedLimiter, billingRouter);
app.use("/api/referrals", authenticatedLimiter, referralsRouter);
app.use("/api/support", authenticatedLimiter, supportRouter);
app.use("/api/quality", authenticatedLimiter, qualityBackfillRouter);
app.use("/api/analytics", authenticatedLimiter, analyticsRouter);
app.use("/api/audit", authenticatedLimiter, auditRouter);
app.use("/api/personas", authenticatedLimiter, personasRouter);
app.use("/api/projects", authenticatedLimiter, projectsRouter);
app.use("/api/boards", authenticatedLimiter, boardsRouter);
app.use("/api/attachments", authenticatedLimiter, attachmentsRouter);
app.use("/api/specs", authenticatedLimiter, specsRouter);
app.use("/api/issues", authenticatedLimiter, issuesRouter);
app.use("/api/prd", authenticatedLimiter, prdRouter);
app.use("/api/memory", authenticatedLimiter, memoryRouter);
app.use("/api/compliance", authenticatedLimiter, complianceRouter);
app.use("/api/codebase", authenticatedLimiter, codebaseRouter);
app.use("/api/directives", workerLogLimiter, directivesRouter);

// Showcase routes (public, no auth required)
app.use("/api/showcase", webhookLimiter, showcaseRouter);

// Build page routes (plan preview + execute)
app.use("/api/build", authenticatedLimiter, buildRouter);

// Management dashboard routes (platform admin only)
app.use("/api/management", authenticatedLimiter, managementRouter);

// Marketing content routes (authenticated)
app.use("/api/marketing", authenticatedLimiter, marketingRouter);

// Email routes (unsubscribe is public for CAN-SPAM compliance)
app.use("/api/email", webhookLimiter, emailRouter);

// Worker decision engine routes (API key auth, high volume from workers)
app.use("/api/worker-decisions", workerLogLimiter, workerDecisionsRouter);

// Remote agent routes (API key auth, webhook-level rate limiting)
app.use("/api/agent", webhookLimiter, remoteAgentRouter);

// Task routes with worker log limiter (high volume from workers)
app.use("/api/tasks", workerLogLimiter, tasksRouter);

// V2 Pipeline task routes (vertical slice sequential execution)
app.use("/api/tasks-v2", workerLogLimiter, tasksV2Router);

// Webhook routes with webhook rate limiting (100 req/min per IP)
app.use("/api/webhooks", webhookLimiter, webhooksRouter);
// Direct Jira webhook route (Jira calls POST /jira, forwards to /api/webhooks/jira handler)
app.post("/jira", webhookLimiter, (req, res, next) => {
  req.url = "/jira";
  webhooksRouter(req, res, next);
});

// 404 handler for unknown routes
app.use(notFoundHandler);

// Sentry error handler (must be before our custom error handler)
Sentry.setupExpressErrorHandler(app);

// Global error handler - catches all errors and returns appropriate HTTP status codes
// Uses custom error classes from utils/errors.ts (e.g., NotFoundError, BadRequestError)
app.use(errorHandler);

// Start server
async function start() {
  try {
    // Validate environment variables (fails fast in production if missing)
    validateEnvironment();

    // Initialize encryption for sensitive fields at rest
    initializeEncryption();

    // Initialize database connection
    await AppDataSource.initialize();
    logger.info("Database connection established");

    // Run migrations
    await AppDataSource.runMigrations();
    logger.info("Migrations completed");

    // Seed local mode defaults (org + admin user) if needed
    await seedLocalModeIfNeeded();

    // Seed system persona directives if missing
    await seedDirectivesIfMissing();

    // Seed system persona scripts if missing
    await seedScriptsIfMissing();

    // Connect Redis for coordination pub/sub (optional — falls back to DB polling)
    if (config.redisUrl) {
      redis.connect(config.redisUrl);

      // Initialize cross-instance event bridging
      const { costEvents } = await import("./services/cost-events.js");
      const { planningProgressEmitter } = await import("./services/planning-progress-events.js");
      const { codeEventEmitter } = await import("./services/code-events.js");
      const { decompositionEmitter } = await import("./services/decomposition-events.js");
      const { initCredentialCacheSubscription } = await import("./services/org-credentials.js");

      costEvents.initRedisSubscription();
      planningProgressEmitter.initRedisSubscription();
      codeEventEmitter.initRedisSubscription();
      decompositionEmitter.initRedisSubscription();
      initCredentialCacheSubscription();

      logger.info("Redis event bridging initialized");
    } else {
      logger.info("Redis not configured — SSE will use DB polling fallback");
    }

    // Start orchestrator (unless disabled)
    if (process.env.ENABLE_ORCHESTRATOR !== "false") {
      startOrchestrator();
      logger.info("Orchestrator started");
    } else {
      logger.info("Orchestrator disabled via ENABLE_ORCHESTRATOR=false");
    }

    // Start HTTP server (store handle for graceful shutdown)
    const port = config.port;
    const server = app.listen(port, () => {
      logger.info(`WorkerMill API listening on port ${port}`);
    });

    // Graceful shutdown: drain connections before exiting
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully`);
      stopOrchestrator();

      // Wait for fire-and-forget operations to complete (max 20s)
      if (activeOps.size > 0) {
        logger.info(`Waiting for ${activeOps.size} active operations to complete`);
        await Promise.race([
          Promise.allSettled([...activeOps]),
          new Promise((resolve) => setTimeout(resolve, 20_000)),
        ]);
      }

      // Stop accepting new connections and wait for in-flight requests to finish
      server.close(async () => {
        logger.info("HTTP server closed, cleaning up resources");
        stopPoolMonitor();
        await redis.disconnect();
        await AppDataSource.destroy();
        process.exit(0);
      });

      // Force exit after 25 seconds (ECS default stopTimeout is 30s)
      setTimeout(() => {
        logger.warn("Graceful shutdown timed out, forcing exit");
        process.exit(1);
      }, 25_000).unref();
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error("Failed to start server", {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
    console.error("Startup error:", err);
    process.exit(1);
  }
}

// Handle unhandled promise rejections - prevents silent failures
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection", {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
    promise: String(promise),
  });
  // Report to Sentry if available
  if (Sentry) {
    Sentry.captureException(reason);
  }
  // Note: In Node.js 18+, unhandled rejections will terminate the process by default
  // We log but don't exit to allow graceful recovery where possible
});

// Handle uncaught exceptions - these are more serious and require exit
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception - shutting down", {
    message: error.message,
    stack: error.stack,
    name: error.name,
  });
  // Report to Sentry if available
  if (Sentry) {
    Sentry.captureException(error);
  }
  // Must exit after uncaught exception - process state is undefined
  process.exit(1);
});

start();
