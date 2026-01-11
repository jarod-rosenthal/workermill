import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config/index.js";
import { AppDataSource } from "./db/connection.js";
import { logger } from "./utils/logger.js";
import {
  healthRouter,
  authRouter,
  tasksRouter,
  webhooksRouter,
  organizationsRouter,
  controlCenterRouter,
  systemRouter,
  watcherRouter,
  orchestratorRouter,
  managerRouter,
} from "./routes/index.js";

const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  })
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
app.use("/api/tasks", tasksRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/control-center", controlCenterRouter);
app.use("/api/system", systemRouter);
app.use("/api/watcher", watcherRouter);
app.use("/api/orchestrator", orchestratorRouter);
app.use("/api/manager", managerRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
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
  await AppDataSource.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  await AppDataSource.destroy();
  process.exit(0);
});

start();
