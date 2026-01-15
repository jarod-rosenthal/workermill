#!/usr/bin/env npx ts-node
"use strict";
/**
 * Build and push a container image using Kaniko in a separate ECS task
 *
 * This spawns Kaniko in a dedicated ECS task to avoid filesystem conflicts
 * with the worker container. The Kaniko task uses Git context to fetch
 * the source code directly from GitHub.
 *
 * Inputs (environment variables):
 * - DOCKERFILE_PATH: Optional. Path to Dockerfile relative to repo root (defaults to "Dockerfile")
 * - IMAGE_NAME: Required. Full image name including registry (e.g., "593971626975.dkr.ecr.us-east-1.amazonaws.com/oncallshift-dev/backend:latest")
 * - BUILD_ARGS: Optional. Comma-separated build args (e.g., "NODE_ENV=production,VERSION=1.0.0")
 * - AWS_REGION: Optional. AWS region for ECR auth (defaults to us-east-1)
 * - CACHE_REPO: Optional. ECR repo for layer caching
 * - GITHUB_TOKEN: Required. GitHub token for Git context authentication
 * - GITHUB_REPO: Required. GitHub repo (e.g., "jarod-rosenthal/pagerduty-lite")
 * - GIT_BRANCH: Optional. Git branch to build from (defaults to "main")
 * - ECS_CLUSTER: Required. ECS cluster name (e.g., "workermill-dev")
 * - VPC_SUBNETS: Required. Comma-separated subnet IDs
 * - VPC_SECURITY_GROUPS: Required. Comma-separated security group IDs
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - imageName: string
 * - digest?: string
 * - error?: string
 * - taskArn?: string
 */
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const client_ecs_1 = require("@aws-sdk/client-ecs");
const client_cloudwatch_logs_1 = require("@aws-sdk/client-cloudwatch-logs");
function exec(cmd) {
    console.error(`[build_container] Running: ${cmd}`);
    return (0, child_process_1.execSync)(cmd, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 50 * 1024 * 1024,
    }).trim();
}
async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Create a dedicated task definition for Kaniko builds
 * We need a separate task definition because:
 * 1. We need to use the official Kaniko image
 * 2. We need different IAM permissions (ECR push)
 * 3. We can't override the image in containerOverrides (ECS limitation)
 */
async function createKanikoTaskDefinition(ecsClient, region, kanikoCommand, kanikoEnv) {
    const taskDefName = `kaniko-build-${Date.now()}`;
    console.error(`[build_container] Creating Kaniko task definition: ${taskDefName}`);
    // Get the execution role and task role from the worker task definition
    // We'll reuse them for Kaniko
    const workerTaskDef = process.env.WORKER_TASK_DEFINITION || "workermill-dev-worker";
    // Register a new task definition for Kaniko
    const registerCommand = new client_ecs_1.RegisterTaskDefinitionCommand({
        family: taskDefName,
        networkMode: "awsvpc",
        requiresCompatibilities: ["FARGATE"],
        cpu: "1024", // 1 vCPU
        memory: "4096", // 4 GB - Kaniko builds can be memory-intensive
        executionRoleArn: `arn:aws:iam::593971626975:role/workermill-dev-ecs-execution-role`,
        taskRoleArn: `arn:aws:iam::593971626975:role/workermill-dev-worker-task-role`,
        containerDefinitions: [
            {
                name: "kaniko",
                image: "gcr.io/kaniko-project/executor:latest",
                essential: true,
                command: kanikoCommand,
                environment: kanikoEnv,
                logConfiguration: {
                    logDriver: "awslogs",
                    options: {
                        "awslogs-group": `/ecs/workermill-dev/kaniko`,
                        "awslogs-region": region,
                        "awslogs-stream-prefix": "kaniko",
                        "awslogs-create-group": "true",
                    },
                },
            },
        ],
    });
    const result = await ecsClient.send(registerCommand);
    const taskDefArn = result.taskDefinition?.taskDefinitionArn;
    if (!taskDefArn) {
        throw new Error("Failed to create Kaniko task definition");
    }
    console.error(`[build_container] Created task definition: ${taskDefArn}`);
    return taskDefArn;
}
/**
 * Clean up the temporary Kaniko task definition
 */
async function cleanupTaskDefinition(ecsClient, taskDefArn) {
    try {
        console.error(`[build_container] Deregistering task definition: ${taskDefArn}`);
        await ecsClient.send(new client_ecs_1.DeregisterTaskDefinitionCommand({
            taskDefinition: taskDefArn,
        }));
    }
    catch (error) {
        console.error(`[build_container] Warning: Failed to deregister task definition: ${error}`);
    }
}
/**
 * Run Kaniko in a separate ECS task and wait for completion
 */
async function runKanikoTask(imageName, dockerfilePath, buildArgs, cacheRepo, region) {
    const ecsClient = new client_ecs_1.ECSClient({ region });
    const logsClient = new client_cloudwatch_logs_1.CloudWatchLogsClient({ region });
    const cluster = process.env.ECS_CLUSTER;
    const subnets = process.env.VPC_SUBNETS?.split(",").map((s) => s.trim()).filter(Boolean);
    const securityGroups = process.env.VPC_SECURITY_GROUPS?.split(",").map((s) => s.trim()).filter(Boolean);
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO;
    const gitBranch = process.env.GIT_BRANCH || "main";
    if (!cluster) {
        throw new Error("ECS_CLUSTER environment variable is required");
    }
    if (!subnets || subnets.length === 0) {
        throw new Error("VPC_SUBNETS environment variable is required");
    }
    if (!securityGroups || securityGroups.length === 0) {
        throw new Error("VPC_SECURITY_GROUPS environment variable is required");
    }
    if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
    }
    if (!githubRepo) {
        throw new Error("GITHUB_REPO environment variable is required");
    }
    // Build Kaniko command arguments
    // Use Git context to fetch source directly from GitHub
    const kanikoCommand = [
        "--context",
        `git://github.com/${githubRepo}#refs/heads/${gitBranch}`,
        "--dockerfile",
        dockerfilePath,
        "--destination",
        imageName,
        "--verbosity",
        "info",
    ];
    // Add build args
    if (buildArgs) {
        for (const arg of buildArgs.split(",")) {
            const trimmed = arg.trim();
            if (trimmed) {
                kanikoCommand.push("--build-arg", trimmed);
            }
        }
    }
    // Add cache configuration if specified
    if (cacheRepo) {
        kanikoCommand.push("--cache=true");
        kanikoCommand.push("--cache-repo", cacheRepo);
    }
    // Environment variables for Kaniko container
    const kanikoEnv = [
        { name: "GIT_TOKEN", value: githubToken },
        { name: "GIT_USERNAME", value: "x-access-token" },
        { name: "AWS_REGION", value: region },
    ];
    console.error(`[build_container] Kaniko command: ${kanikoCommand.join(" ")}`);
    console.error(`[build_container] Git context: git://github.com/${githubRepo}#refs/heads/${gitBranch}`);
    // Create a dedicated task definition for Kaniko
    const taskDefArn = await createKanikoTaskDefinition(ecsClient, region, kanikoCommand, kanikoEnv);
    try {
        // Spawn the Kaniko ECS task
        const runTaskCommand = new client_ecs_1.RunTaskCommand({
            cluster,
            taskDefinition: taskDefArn,
            launchType: "FARGATE",
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets,
                    securityGroups,
                    assignPublicIp: "ENABLED",
                },
            },
        });
        console.error(`[build_container] Spawning Kaniko ECS task in cluster: ${cluster}`);
        const runResult = await ecsClient.send(runTaskCommand);
        if (!runResult.tasks || runResult.tasks.length === 0) {
            const failure = runResult.failures?.[0];
            throw new Error(`Failed to start Kaniko task: ${failure?.reason || "Unknown error"}`);
        }
        const taskArn = runResult.tasks[0].taskArn;
        if (!taskArn) {
            throw new Error("Task started but no ARN returned");
        }
        // Extract task ID from ARN for log streaming
        const taskId = taskArn.split("/").pop();
        console.error(`[build_container] Kaniko task started: ${taskArn}`);
        console.error(`[build_container] Task ID: ${taskId}`);
        // Poll for task completion
        const pollIntervalMs = 10000; // 10 seconds
        const timeoutMs = 600000; // 10 minutes
        const startTime = Date.now();
        let lastStatus = "";
        let exitCode;
        let stoppedReason;
        while (Date.now() - startTime < timeoutMs) {
            await sleep(pollIntervalMs);
            const describeResult = await ecsClient.send(new client_ecs_1.DescribeTasksCommand({
                cluster,
                tasks: [taskArn],
            }));
            const task = describeResult.tasks?.[0];
            if (!task) {
                throw new Error("Task disappeared during execution");
            }
            const currentStatus = task.lastStatus || "UNKNOWN";
            if (currentStatus !== lastStatus) {
                console.error(`[build_container] Task status: ${currentStatus}`);
                lastStatus = currentStatus;
            }
            if (currentStatus === "STOPPED") {
                stoppedReason = task.stoppedReason;
                const container = task.containers?.find((c) => c.name === "kaniko");
                exitCode = container?.exitCode;
                console.error(`[build_container] Task stopped. Exit code: ${exitCode}`);
                if (stoppedReason) {
                    console.error(`[build_container] Stopped reason: ${stoppedReason}`);
                }
                break;
            }
        }
        if (lastStatus !== "STOPPED") {
            throw new Error(`Task timed out after ${timeoutMs / 1000} seconds`);
        }
        // Get logs from CloudWatch to extract digest
        let digest;
        const logGroupName = `/ecs/workermill-dev/kaniko`;
        const logStreamName = `kaniko/kaniko/${taskId}`;
        console.error(`[build_container] Fetching logs from ${logGroupName}/${logStreamName}`);
        try {
            // Wait a moment for logs to be available
            await sleep(5000);
            const logsResult = await logsClient.send(new client_cloudwatch_logs_1.GetLogEventsCommand({
                logGroupName,
                logStreamName,
                startFromHead: false,
                limit: 100, // Get last 100 log events
            }));
            const logEvents = logsResult.events || [];
            console.error(`[build_container] Retrieved ${logEvents.length} log events`);
            // Search for digest in logs
            for (const event of logEvents) {
                const message = event.message || "";
                const digestMatch = message.match(/digest:\s*(sha256:[a-f0-9]+)/i);
                if (digestMatch) {
                    digest = digestMatch[1];
                    console.error(`[build_container] Found digest: ${digest}`);
                    break;
                }
            }
            // If not found in recent events, try getting all logs
            if (!digest) {
                const allLogsResult = await logsClient.send(new client_cloudwatch_logs_1.GetLogEventsCommand({
                    logGroupName,
                    logStreamName,
                    startFromHead: true,
                    limit: 1000,
                }));
                for (const event of allLogsResult.events || []) {
                    const message = event.message || "";
                    const digestMatch = message.match(/digest:\s*(sha256:[a-f0-9]+)/i);
                    if (digestMatch) {
                        digest = digestMatch[1];
                        console.error(`[build_container] Found digest in full logs: ${digest}`);
                        break;
                    }
                }
            }
        }
        catch (logError) {
            console.error(`[build_container] Warning: Could not fetch logs: ${logError}`);
            // Continue - we can still succeed without the digest
        }
        // Check if build was successful
        if (exitCode !== 0) {
            return {
                success: false,
                taskArn,
                error: `Kaniko build failed with exit code ${exitCode}. Reason: ${stoppedReason || "Unknown"}`,
            };
        }
        return {
            success: true,
            digest,
            taskArn,
        };
    }
    finally {
        // Clean up the temporary task definition
        await cleanupTaskDefinition(ecsClient, taskDefArn);
    }
}
async function main() {
    const output = { success: false };
    try {
        const dockerfilePath = process.env.DOCKERFILE_PATH || "Dockerfile";
        const imageName = process.env.IMAGE_NAME;
        const buildArgs = process.env.BUILD_ARGS || "";
        const region = process.env.AWS_REGION || "us-east-1";
        const cacheRepo = process.env.CACHE_REPO;
        if (!imageName) {
            throw new Error("IMAGE_NAME environment variable is required");
        }
        output.imageName = imageName;
        // Extract ECR registry from image name for repository creation
        const registryMatch = imageName.match(/^(\d+\.dkr\.ecr\.[^/]+\.amazonaws\.com)/);
        if (!registryMatch) {
            throw new Error(`Invalid ECR image name format: ${imageName}. Expected format: ACCOUNT.dkr.ecr.REGION.amazonaws.com/repo:tag`);
        }
        const registry = registryMatch[1];
        // Ensure ECR repository exists
        const repoName = imageName.replace(registry + "/", "").split(":")[0];
        console.error(`[build_container] Ensuring ECR repository exists: ${repoName}`);
        try {
            exec(`aws ecr describe-repositories --repository-names ${repoName} --region ${region}`);
        }
        catch {
            console.error(`[build_container] Creating ECR repository: ${repoName}`);
            exec(`aws ecr create-repository --repository-name ${repoName} --region ${region}`);
        }
        console.error(`[build_container] Building image: ${imageName}`);
        console.error(`[build_container] Dockerfile: ${dockerfilePath}`);
        console.error(`[build_container] Using separate ECS task for Kaniko build`);
        // Run Kaniko in a separate ECS task
        const result = await runKanikoTask(imageName, dockerfilePath, buildArgs, cacheRepo, region);
        output.success = result.success;
        output.digest = result.digest;
        output.taskArn = result.taskArn;
        if (!result.success) {
            throw new Error(result.error || "Kaniko build failed");
        }
        console.error(`[build_container] Successfully built and pushed: ${imageName}`);
    }
    catch (error) {
        output.error = error instanceof Error ? error.message : String(error);
        console.error(`[build_container] Error: ${output.error}`);
    }
    console.log(JSON.stringify(output));
    // Output markers for orchestrator
    if (output.success) {
        console.error(`::result::container_built`);
        console.error(`::image::${output.imageName}`);
        if (output.digest) {
            console.error(`::digest::${output.digest}`);
        }
    }
    process.exit(output.success ? 0 : 1);
}
main();
