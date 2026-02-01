import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { isOrchestratorRunning } from "../services/orchestrator.js";

const router = Router();

type ServiceStatus = "operational" | "degraded" | "outage";

interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  checkedAt: string;
  responseTime?: number;
  message?: string;
}

interface StatusResponse {
  status: ServiceStatus;
  timestamp: string;
  services: {
    api: ServiceHealth;
    database: ServiceHealth;
    taskProcessing: ServiceHealth;
    cdn: ServiceHealth;
  };
}

/**
 * GET /api/status
 * Public status endpoint - no authentication required
 * Returns health status of all WorkerMill services
 */
router.get("/", async (_req: Request, res: Response) => {
  const timestamp = new Date().toISOString();

  // API is operational if this endpoint responds
  const apiHealth: ServiceHealth = {
    name: "API Service",
    status: "operational",
    checkedAt: timestamp,
  };

  // Database health check with response time measurement
  let databaseHealth: ServiceHealth;
  try {
    const startTime = Date.now();
    await AppDataSource.query("SELECT 1");
    const responseTime = Date.now() - startTime;

    let status: ServiceStatus = "operational";
    if (responseTime > 2000) {
      status = "outage";
    } else if (responseTime > 500) {
      status = "degraded";
    }

    databaseHealth = {
      name: "Database",
      status,
      checkedAt: timestamp,
      responseTime,
    };
  } catch (error) {
    databaseHealth = {
      name: "Database",
      status: "outage",
      checkedAt: timestamp,
      message: "Connection failed",
    };
  }

  // Task processing (orchestrator) status
  const orchestratorRunning = isOrchestratorRunning();
  const taskProcessingHealth: ServiceHealth = {
    name: "Task Processing",
    status: orchestratorRunning ? "operational" : "degraded",
    checkedAt: timestamp,
    message: orchestratorRunning ? "Orchestrator active" : "Maintenance mode",
  };

  // CDN is implicitly operational if the page loads
  const cdnHealth: ServiceHealth = {
    name: "CDN / Frontend",
    status: "operational",
    checkedAt: timestamp,
  };

  // Calculate overall status
  const allStatuses = [
    apiHealth.status,
    databaseHealth.status,
    taskProcessingHealth.status,
    cdnHealth.status,
  ];

  let overallStatus: ServiceStatus = "operational";
  if (allStatuses.includes("outage")) {
    overallStatus = "outage";
  } else if (allStatuses.includes("degraded")) {
    overallStatus = "degraded";
  }

  const response: StatusResponse = {
    status: overallStatus,
    timestamp,
    services: {
      api: apiHealth,
      database: databaseHealth,
      taskProcessing: taskProcessingHealth,
      cdn: cdnHealth,
    },
  };

  res.json(response);
});

export default router;
