/**
 * Rollback ECS service to previous task definition
 *
 * This script rolls back an ECS service to the previous task definition
 * version in case of deployment issues.
 *
 * Environment variables:
 * - CLUSTER_NAME: ECS cluster name (required)
 * - SERVICE_NAME: ECS service name (required)
 * - AWS_REGION: AWS region (default: us-east-1)
 * - ROLLBACK_REVISIONS: Number of revisions to roll back (default: 1)
 */

import { execSync } from "child_process";

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
      return awsPath;
    } catch {
      // Try next
    }
  }

  // If no direct access, try with sudo
  try {
    execSync("sudo /usr/local/bin/aws --version", { stdio: "pipe" });
    return "sudo /usr/local/bin/aws";
  } catch {
    // Continue
  }

  throw new Error("AWS CLI not found");
}

const cluster = process.env.CLUSTER_NAME;
const service = process.env.SERVICE_NAME;
const region = process.env.AWS_REGION || "us-east-1";
const rollbackRevisions = parseInt(process.env.ROLLBACK_REVISIONS || "1");

if (!cluster) {
  console.error("ERROR: CLUSTER_NAME environment variable not set");
  process.exit(1);
}

if (!service) {
  console.error("ERROR: SERVICE_NAME environment variable not set");
  process.exit(1);
}

console.log("=== ECS Rollback ===");
console.log(`Cluster: ${cluster}`);
console.log(`Service: ${service}`);
console.log(`Region: ${region}`);
console.log(`Rollback revisions: ${rollbackRevisions}`);
console.log("");

// Find AWS CLI
const awsCli = findAwsCli();

try {
  // Get current service details
  console.log("Fetching current service configuration...");
  const describeResult = execSync(
    `${awsCli} ecs describe-services --cluster ${cluster} --services ${service} --region ${region}`,
    { encoding: "utf-8" }
  );

  const services = JSON.parse(describeResult);
  const svc = services.services?.[0];

  if (!svc) {
    console.error("ERROR: Service not found");
    process.exit(1);
  }

  const currentTaskDef = svc.taskDefinition;
  console.log(`Current task definition: ${currentTaskDef}`);

  // Parse task definition ARN to get family and revision
  // Format: arn:aws:ecs:region:account:task-definition/family:revision
  const taskDefMatch = currentTaskDef.match(/task-definition\/(.+):(\d+)$/);
  if (!taskDefMatch) {
    console.error("ERROR: Could not parse task definition ARN");
    process.exit(1);
  }

  const family = taskDefMatch[1];
  const currentRevision = parseInt(taskDefMatch[2]);
  const targetRevision = currentRevision - rollbackRevisions;

  if (targetRevision < 1) {
    console.error(`ERROR: Cannot rollback ${rollbackRevisions} revisions from revision ${currentRevision}`);
    console.error("Target revision would be less than 1");
    process.exit(1);
  }

  const targetTaskDef = `${family}:${targetRevision}`;
  console.log(`Target task definition: ${targetTaskDef}`);
  console.log("");

  // Verify target task definition exists
  console.log("Verifying target task definition exists...");
  try {
    execSync(
      `${awsCli} ecs describe-task-definition --task-definition ${targetTaskDef} --region ${region}`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    console.log("Target task definition verified");
  } catch {
    console.error(`ERROR: Task definition ${targetTaskDef} does not exist`);
    console.error("It may have been deregistered");
    process.exit(1);
  }

  // Update service to use previous task definition
  console.log("");
  console.log("Rolling back service...");
  const updateResult = execSync(
    `${awsCli} ecs update-service --cluster ${cluster} --service ${service} --task-definition ${targetTaskDef} --region ${region}`,
    { encoding: "utf-8" }
  );

  const updateResponse = JSON.parse(updateResult);
  const newTaskDef = updateResponse.service?.taskDefinition;

  console.log("");
  console.log("=== Rollback Initiated ===");
  console.log(`Previous: ${currentTaskDef}`);
  console.log(`New: ${newTaskDef}`);
  console.log("");
  console.log("Waiting for service to stabilize...");

  // Wait for service to stabilize
  try {
    execSync(
      `${awsCli} ecs wait services-stable --cluster ${cluster} --services ${service} --region ${region}`,
      { encoding: "utf-8", timeout: 600000, stdio: "inherit" }
    );

    console.log("");
    console.log("=== Rollback Complete ===");
    console.log(`Service ${service} rolled back to revision ${targetRevision}`);
    console.log(`::rollback_complete::${targetTaskDef}`);
  } catch {
    console.error("");
    console.error("WARNING: Service did not stabilize within timeout");
    console.error("Check ECS console for status");
    console.log(`::rollback_timeout::${targetTaskDef}`);
  }
} catch (error) {
  console.error("");
  console.error("ERROR: Rollback failed");
  if (error instanceof Error) {
    console.error("Message:", error.message);
  }
  console.log("::rollback_failed::");
  process.exit(1);
}
