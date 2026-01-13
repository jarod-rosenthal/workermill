/**
 * Deploy to ECS by forcing a new deployment
 *
 * This script triggers an ECS service update to pull the latest image
 * and perform a rolling deployment.
 *
 * Environment variables:
 * - CLUSTER_NAME: ECS cluster name (required)
 * - SERVICE_NAME: ECS service name (required)
 * - AWS_REGION: AWS region (default: us-east-1)
 * - WAIT_FOR_STABLE: Wait for deployment to stabilize (default: true)
 * - WAIT_TIMEOUT: Timeout in seconds for stabilization (default: 600)
 */

import { execSync, spawnSync } from "child_process";

// Find AWS CLI - try multiple locations
function findAwsCli(): string {
  const paths = [
    "/usr/local/bin/aws",  // Standard AWS CLI v2 location
    "/usr/bin/aws",        // Some distros
    "aws",                 // In PATH
  ];

  for (const awsPath of paths) {
    try {
      execSync(`${awsPath} --version`, { stdio: "pipe" });
      console.log(`[deploy_ecs] Found AWS CLI at: ${awsPath}`);
      return awsPath;
    } catch {
      // Try next
    }
  }

  // If no direct access, try with sudo
  try {
    execSync("sudo /usr/local/bin/aws --version", { stdio: "pipe" });
    console.log("[deploy_ecs] AWS CLI accessible via sudo");
    return "sudo /usr/local/bin/aws";
  } catch {
    // Continue
  }

  console.error("[deploy_ecs] ERROR: AWS CLI not found in any known location");
  console.error("[deploy_ecs] PATH:", process.env.PATH);
  throw new Error("AWS CLI not found");
}

const cluster = process.env.CLUSTER_NAME;
const service = process.env.SERVICE_NAME;
const region = process.env.AWS_REGION || "us-east-1";
const waitForStable = process.env.WAIT_FOR_STABLE !== "false";
const waitTimeout = parseInt(process.env.WAIT_TIMEOUT || "600");

if (!cluster) {
  console.error("ERROR: CLUSTER_NAME environment variable not set");
  process.exit(1);
}

if (!service) {
  console.error("ERROR: SERVICE_NAME environment variable not set");
  process.exit(1);
}

console.log("=== ECS Deployment ===");
console.log(`Cluster: ${cluster}`);
console.log(`Service: ${service}`);
console.log(`Region: ${region}`);
console.log(`Wait for stable: ${waitForStable}`);
console.log("");

// Find AWS CLI
const awsCli = findAwsCli();

try {
  // Force new deployment
  console.log("Triggering deployment...");
  const updateResult = execSync(
    `${awsCli} ecs update-service --cluster ${cluster} --service ${service} --force-new-deployment --region ${region}`,
    { encoding: "utf-8" }
  );

  const response = JSON.parse(updateResult);
  const taskDef = response.service?.taskDefinition || "unknown";
  const desiredCount = response.service?.desiredCount || 0;
  const runningCount = response.service?.runningCount || 0;

  console.log("");
  console.log("Deployment initiated:");
  console.log(`  Task Definition: ${taskDef}`);
  console.log(`  Desired Count: ${desiredCount}`);
  console.log(`  Running Count: ${runningCount}`);
  console.log("");

  console.log(`::deployment_started::${service}`);
  console.log(`::task_definition::${taskDef}`);

  if (waitForStable) {
    console.log(`Waiting for deployment to stabilize (timeout: ${waitTimeout}s)...`);
    console.log("This may take a few minutes...");
    console.log("");

    try {
      execSync(
        `${awsCli} ecs wait services-stable --cluster ${cluster} --services ${service} --region ${region}`,
        {
          encoding: "utf-8",
          timeout: waitTimeout * 1000,
          stdio: "inherit",
        }
      );

      console.log("");
      console.log("=== Deployment Successful ===");
      console.log(`Service ${service} is now stable`);
      console.log(`::deployment_complete::${service}`);
    } catch (waitError) {
      console.error("");
      console.error("WARNING: Deployment did not stabilize within timeout");
      console.error("The deployment may still be in progress.");
      console.error("Check ECS console for status.");
      console.log(`::deployment_timeout::${service}`);
      // Don't exit with error - deployment might still succeed
    }
  } else {
    console.log("=== Deployment Triggered ===");
    console.log("Not waiting for stabilization (WAIT_FOR_STABLE=false)");
    console.log(`::deployment_triggered::${service}`);
  }
} catch (error) {
  console.error("");
  console.error("ERROR: ECS deployment failed");
  if (error instanceof Error) {
    console.error("Message:", error.message);
  }

  // Try to get more details
  try {
    const describeResult = execSync(
      `${awsCli} ecs describe-services --cluster ${cluster} --services ${service} --region ${region}`,
      { encoding: "utf-8" }
    );
    const services = JSON.parse(describeResult);
    const svc = services.services?.[0];

    if (svc?.events?.length > 0) {
      console.error("");
      console.error("Recent service events:");
      svc.events.slice(0, 5).forEach((event: { message: string; createdAt: string }) => {
        console.error(`  - ${event.message}`);
      });
    }
  } catch {
    // Ignore errors from describe
  }

  console.log(`::deployment_failed::${service}`);
  process.exit(1);
}
