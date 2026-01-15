import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import helmet from "helmet";

// Initialize Sentry for error tracking (only if DSN is configured)
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: 0.1, // 10% of transactions
  enabled: !!process.env.SENTRY_DSN,
});
import { config } from "./config/index.js";
import { AppDataSource } from "./db/connection.js";
import { logger } from "./utils/logger.js";
import {
  healthRouter,
  authRouter,
  profileRouter,
  tasksRouter,
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
} from "./routes/index.js";
import {
  verifyWebhookSignature,
  handleCheckoutSessionCompleted,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from "./services/billing.js";
import { startOrchestrator, stopOrchestrator } from "./services/orchestrator.js";

const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  })
);

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

// Body parsing
app.use(express.json({ limit: "10mb" }));
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

// Routes
app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/webhooks", webhooksRouter);
// Direct Jira webhook route (Jira calls POST /jira, forwards to /api/webhooks/jira handler)
app.post("/jira", (req, res, next) => {
  req.url = "/jira";
  webhooksRouter(req, res, next);
});
app.use("/api/organizations", organizationsRouter);
app.use("/api/invites", inviteRouter);
app.use("/api/control-center", controlCenterRouter);
app.use("/api/system", systemRouter);
app.use("/api/watcher", watcherRouter);
app.use("/api/orchestrator", orchestratorRouter);
app.use("/api/manager", managerRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/coordination", coordinationRouter);
app.use("/api/billing", billingRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/personas", personasRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Sentry error handler (must be before generic error handler)
Sentry.setupExpressErrorHandler(app);

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    // Capture exception in Sentry
    Sentry.captureException(err);
    logger.error("Unhandled error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error" });
  }
);

// Start server
async function start() {
  try {
    // Initialize database connection
    await AppDataSource.initialize();
    logger.info("Database connection established");

    // Run migrations
    await AppDataSource.runMigrations();
    logger.info("Migrations completed");

    // Start orchestrator (unless disabled)
    if (process.env.ENABLE_ORCHESTRATOR !== "false") {
      startOrchestrator();
      logger.info("Orchestrator started");
    } else {
      logger.info("Orchestrator disabled via ENABLE_ORCHESTRATOR=false");
    }

    // Start HTTP server
    const port = config.port;
    app.listen(port, () => {
      logger.info(`WorkerMill API listening on port ${port}`);
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  stopOrchestrator();
  await AppDataSource.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  stopOrchestrator();
  await AppDataSource.destroy();
  process.exit(0);
});

start();
