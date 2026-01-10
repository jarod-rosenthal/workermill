/**
 * WorkerMill API
 *
 * Express-based REST API for the WorkerMill control center.
 */

import express, { Express, Router } from "express";
import cors from "cors";
import type { DataSource } from "typeorm";

import controlCenterRoutes, {
  setDataSource as setControlCenterDataSource,
} from "./routes/control-center";

import {
  authenticate,
  requireAdmin,
  setAuthProvider,
  getAuthProvider,
  SimpleApiKeyProvider,
  type AuthProvider,
} from "./middleware/auth";

export interface WorkerMillApiConfig {
  /** TypeORM DataSource for database access */
  dataSource: DataSource;

  /** Authentication provider */
  authProvider: AuthProvider;

  /** CORS origins (default: *) */
  corsOrigins?: string | string[];

  /** API route prefix (default: /api/v1) */
  apiPrefix?: string;
}

/**
 * Create and configure the WorkerMill API Express app
 */
export function createApi(config: WorkerMillApiConfig): Express {
  const app = express();

  // Configure data source
  setControlCenterDataSource(config.dataSource);

  // Configure auth provider
  setAuthProvider(config.authProvider);

  // Middleware
  app.use(express.json());
  app.use(
    cors({
      origin: config.corsOrigins || "*",
      credentials: true,
    })
  );

  // Routes
  const prefix = config.apiPrefix || "/api/v1";
  app.use(`${prefix}/control-center`, controlCenterRoutes);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  return app;
}

/**
 * Create the API router only (for mounting in existing Express apps)
 */
export function createApiRouter(config: WorkerMillApiConfig): Router {
  const router = Router();

  // Configure data source
  setControlCenterDataSource(config.dataSource);

  // Configure auth provider
  setAuthProvider(config.authProvider);

  // Routes
  router.use("/control-center", controlCenterRoutes);

  return router;
}

// Export components for custom configuration
export {
  controlCenterRoutes,
  authenticate,
  requireAdmin,
  setAuthProvider,
  getAuthProvider,
  SimpleApiKeyProvider,
};
export type { AuthProvider };
