#!/usr/bin/env npx ts-node

/**
 * Full-Stack Deployment Script for AI Agents
 *
 * A unified deployment script that handles backend and frontend deployments.
 *
 * Usage:
 *   node /app/execution-compiled/deploy/full_deploy.js [options]
 *
 * Options:
 *   --backend         Deploy backend only (build container + ECS)
 *   --frontend        Deploy frontend only (S3 + CloudFront)
 *   --all             Deploy both backend and frontend
 *   --auto            Auto-detect what changed and deploy accordingly (default)
 *   --skip-build      Skip container/frontend build (deploy existing artifacts)
 *   --skip-wait       Don't wait for ECS stabilization
 *   --dry-run         Show what would be deployed without actually deploying
 *
 * Environment variables (or set via .workermill/deploy.json):
 *   REPO_PATH                    Path to repository (default: /workspace/repo)
 *   AWS_REGION                   AWS region (default: us-east-1)
 *   ECS_CLUSTER                  ECS cluster name (required for backend)
 *   ECS_SERVICE                  ECS service name (required for backend)
 *   ECR_REPO                     ECR repository URL (required for backend)
 *   S3_BUCKET                    S3 bucket for frontend (required for frontend)
 *   CLOUDFRONT_DISTRIBUTION_ID   CloudFront distribution ID (required for frontend)
 *   FRONTEND_BUILD_DIR           Frontend build output (default: ./frontend/dist)
 *   IMAGE_TAG                    Override image tag (default: git commit hash)
 *
 * Examples:
 *   # Deploy everything (auto-detect changes)
 *   node /app/execution-compiled/deploy/full_deploy.js
 *
 *   # Deploy backend only
 *   node /app/execution-compiled/deploy/full_deploy.js --backend
 *
 *   # Deploy frontend only
 *   node /app/execution-compiled/deploy/full_deploy.js --frontend
 *
 *   # Deploy both
 *   node /app/execution-compiled/deploy/full_deploy.js --all
 *
 *   # Dry run to see what would happen
 *   node /app/execution-compiled/deploy/full_deploy.js --all --dry-run
 */

import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface Options {
  deployBackend: boolean;
  deployFrontend: boolean;
  autoDetect: boolean;
  skipBuild: boolean;
  skipWait: boolean;
  dryRun: boolean;
}

interface Output {
  success: boolean;
  backendDeployed: boolean;
  frontendDeployed: boolean;
  staticSiteDeployed?: boolean;
  backendImage?: string;
  ecsTaskDefinition?: string;
  cloudfrontInvalidationId?: string;
  filesUploaded?: number;
  error?: string;
  dryRun?: boolean;
}

type ProjectType = "static" | "frontend-only" | "backend-only" | "fullstack";

/**
 * WorkerMill deployment configuration schema
 * Read from .workermill/deploy.json in the target repository
 */
interface DeployConfig {
  version?: string;
  region?: string;
  frontend?: {
    bucket: string;
    cdnDistributionId: string;
    buildDir?: string;
  };
  backend?: {
    ecrRepo: string;
    ecsCluster: string;
    ecsService: string;
    healthCheckUrl?: string;
  };
}

/**
 * Load deployment configuration from .workermill/deploy.json
 * Falls back to environment variables if config file doesn't exist
 */
function loadDeployConfig(repoPath: string): DeployConfig | null {
  const configPath = path.join(repoPath, ".workermill", "deploy.json");

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content) as DeployConfig;
      console.error(`[deploy] Loaded config from ${configPath}`);
      return config;
    } catch (error) {
      console.error(`[deploy] WARNING: Failed to parse ${configPath}: ${error}`);
      return null;
    }
  }

  console.error(`[deploy] No .workermill/deploy.json found, using environment variables`);
  return null;
}

// Parse command-line arguments
function parseArgs(): Options {
  const args = process.argv.slice(2);

  const options: Options = {
    deployBackend: false,
    deployFrontend: false,
    autoDetect: true,
    skipBuild: false,
    skipWait: false,
    dryRun: false,
  };

  for (const arg of args) {
    switch (arg) {
      case "--backend":
      case "-b":
        options.deployBackend = true;
        options.autoDetect = false;
        break;
      case "--frontend":
      case "-f":
        options.deployFrontend = true;
        options.autoDetect = false;
        break;
      case "--all":
      case "-a":
        options.deployBackend = true;
        options.deployFrontend = true;
        options.autoDetect = false;
        break;
      case "--auto":
        options.autoDetect = true;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--skip-wait":
        options.skipWait = true;
        break;
      case "--dry-run":
      case "-n":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Full-Stack Deployment Script

Usage: node /app/execution-compiled/deploy/full_deploy.js [options]

Options:
  --backend, -b     Deploy backend only (build container + ECS)
  --frontend, -f    Deploy frontend only (S3 + CloudFront)
  --all, -a         Deploy both backend and frontend
  --auto            Auto-detect what changed and deploy (default)
  --skip-build      Skip build step, deploy existing artifacts
  --skip-wait       Don't wait for ECS deployment to stabilize
  --dry-run, -n     Show what would be deployed without deploying
  --help, -h        Show this help message

Environment Variables (or set via .workermill/deploy.json):
  REPO_PATH                    Repository path (default: /workspace/repo)
  AWS_REGION                   AWS region (default: us-east-1)
  ECS_CLUSTER                  ECS cluster name (required for backend)
  ECS_SERVICE                  ECS service name (required for backend)
  ECR_REPO                     ECR repository URL (required for backend)
  S3_BUCKET                    S3 bucket (required for frontend)
  CLOUDFRONT_DISTRIBUTION_ID   CloudFront distribution ID (required for frontend)
  IMAGE_TAG                    Override image tag (default: git commit hash)

Examples:
  # Auto-detect and deploy what changed
  node full_deploy.js

  # Deploy backend only
  node full_deploy.js --backend

  # Deploy frontend only
  node full_deploy.js --frontend

  # Deploy everything
  node full_deploy.js --all

  # See what would happen without deploying
  node full_deploy.js --all --dry-run
`);
}

// Find AWS CLI in various locations
function findAwsCli(): string {
  const paths = [
    "/usr/local/bin/aws",
    "/usr/bin/aws",
    "aws",
  ];

  for (const awsPath of paths) {
    try {
      execSync(`${awsPath} --version`, { stdio: "pipe" });
      return awsPath;
    } catch {
      // Try next
    }
  }

  // Try with sudo
  try {
    execSync("sudo /usr/local/bin/aws --version", { stdio: "pipe" });
    return "sudo /usr/local/bin/aws";
  } catch {
    // Continue
  }

  throw new Error("AWS CLI not found in any known location");
}

function exec(cmd: string, cwd?: string): string {
  console.error(`[deploy] $ ${cmd}`);
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}

function execSafe(cmd: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  console.error(`[deploy] $ ${cmd}`);
  const result = spawnSync("sh", ["-c", cmd], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status || 0,
  };
}

/**
 * Detect the project type based on repository structure
 * - static: No Dockerfile AND no package.json in root/frontend (pure HTML/CSS/JS)
 * - frontend-only: Has frontend/ or package.json with build script, no Dockerfile
 * - backend-only: Has Dockerfile, no frontend/
 * - fullstack: Has both Dockerfile and frontend/
 */
function detectProjectType(repoPath: string): ProjectType {
  const hasDockerfile = fs.existsSync(path.join(repoPath, "Dockerfile")) ||
                        fs.existsSync(path.join(repoPath, "Dockerfile.api")) ||
                        fs.existsSync(path.join(repoPath, "Dockerfile.backend"));
  const hasFrontendDir = fs.existsSync(path.join(repoPath, "frontend"));
  const hasRootPackageJson = fs.existsSync(path.join(repoPath, "package.json"));
  const hasFrontendPackageJson = fs.existsSync(path.join(repoPath, "frontend", "package.json"));

  // Check if root package.json has a build script (indicates it's a buildable frontend)
  let hasBuildScript = false;
  if (hasRootPackageJson) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(repoPath, "package.json"), "utf-8"));
      hasBuildScript = !!(pkgJson.scripts?.build);
    } catch {
      // Ignore parse errors
    }
  }

  // Check for static site indicators (HTML files in root)
  const rootFiles = fs.readdirSync(repoPath);
  const hasRootHtml = rootFiles.some(f => f.endsWith(".html"));

  console.error(`[deploy] Project detection:`);
  console.error(`[deploy]   Dockerfile: ${hasDockerfile}`);
  console.error(`[deploy]   frontend/: ${hasFrontendDir}`);
  console.error(`[deploy]   package.json: ${hasRootPackageJson} (build script: ${hasBuildScript})`);
  console.error(`[deploy]   frontend/package.json: ${hasFrontendPackageJson}`);
  console.error(`[deploy]   Root HTML files: ${hasRootHtml}`);

  // Static site: No Dockerfile, no frontend build system, but has HTML/CSS/JS
  if (!hasDockerfile && !hasFrontendDir && !hasBuildScript && hasRootHtml) {
    console.error(`[deploy] Project type: STATIC SITE`);
    return "static";
  }

  if (hasDockerfile && (hasFrontendDir || hasFrontendPackageJson)) {
    console.error(`[deploy] Project type: FULLSTACK`);
    return "fullstack";
  }

  if (hasDockerfile) {
    console.error(`[deploy] Project type: BACKEND ONLY`);
    return "backend-only";
  }

  if (hasFrontendDir || hasFrontendPackageJson || hasBuildScript) {
    console.error(`[deploy] Project type: FRONTEND ONLY`);
    return "frontend-only";
  }

  // Default to static if we have HTML but nothing else
  if (hasRootHtml) {
    console.error(`[deploy] Project type: STATIC SITE (fallback)`);
    return "static";
  }

  console.error(`[deploy] Project type: BACKEND ONLY (fallback)`);
  return "backend-only";
}

function detectChanges(repoPath: string): { backend: boolean; frontend: boolean; static: boolean } {
  console.error("[deploy] Auto-detecting changes...");

  // First detect project type
  const projectType = detectProjectType(repoPath);

  // For static sites, always return static=true
  if (projectType === "static") {
    console.error(`[deploy] Static site detected - will sync all files to S3`);
    return { backend: false, frontend: false, static: true };
  }

  try {
    // Try to get diff against main/origin
    let changedFiles: string[] = [];

    try {
      changedFiles = exec("git diff --name-only origin/main...HEAD", repoPath)
        .split("\n").filter(f => f.trim());
    } catch {
      try {
        changedFiles = exec("git diff --name-only main...HEAD", repoPath)
          .split("\n").filter(f => f.trim());
      } catch {
        // Fall back to last commit
        changedFiles = exec("git diff --name-only HEAD~1", repoPath)
          .split("\n").filter(f => f.trim());
      }
    }

    console.error(`[deploy] Found ${changedFiles.length} changed files`);

    let backend = false;
    let frontend = false;

    for (const file of changedFiles) {
      console.error(`[deploy]   - ${file}`);

      // Frontend patterns (only count if project actually has frontend infrastructure)
      if (projectType === "fullstack" || projectType === "frontend-only") {
        if (file.startsWith("frontend/") ||
            file.match(/\.(tsx|jsx|css|scss|sass|less)$/) ||
            file.includes("tailwind") ||
            file.includes("vite") ||
            file.includes("webpack")) {
          frontend = true;
        }
      }

      // Backend patterns (only count if project has backend infrastructure)
      if (projectType === "fullstack" || projectType === "backend-only") {
        if (file.startsWith("src/") ||
            file.startsWith("api/") ||
            file.startsWith("backend/") ||
            file.startsWith("server/") ||
            file === "Dockerfile" ||
            file.includes("migration") ||
            file.match(/package.*\.json$/) ||
            (file.endsWith(".ts") && !file.startsWith("frontend/"))) {
          backend = true;
        }
      }
    }

    // If no specific detection, default based on project type
    if (!backend && !frontend && changedFiles.length > 0) {
      console.error("[deploy] Could not classify changes, using project type defaults");
      backend = projectType === "fullstack" || projectType === "backend-only";
      frontend = projectType === "fullstack" || projectType === "frontend-only";
    }

    console.error(`[deploy] Detected changes: backend=${backend}, frontend=${frontend}`);
    return { backend, frontend, static: false };
  } catch (error) {
    console.error("[deploy] Change detection failed, using project type defaults");
    return {
      backend: projectType === "fullstack" || projectType === "backend-only",
      frontend: projectType === "fullstack" || projectType === "frontend-only",
      static: false,
    };
  }
}

async function deployBackend(
  repoPath: string,
  awsCli: string,
  config: {
    cluster: string;
    service: string;
    ecrRepo: string;
    region: string;
    imageTag?: string;
    skipBuild: boolean;
    skipWait: boolean;
    dryRun: boolean;
  }
): Promise<{ image: string; taskDefinition?: string }> {
  console.error("\n========================================");
  console.error("  BACKEND DEPLOYMENT");
  console.error("========================================\n");

  // Determine image tag
  let imageTag = config.imageTag;
  if (!imageTag) {
    const commitHash = exec("git rev-parse --short HEAD", repoPath);
    imageTag = commitHash;
  }

  const fullImageName = `${config.ecrRepo}:${imageTag}`;
  console.error(`[deploy] Image: ${fullImageName}`);
  console.error(`[deploy] Cluster: ${config.cluster}`);
  console.error(`[deploy] Service: ${config.service}`);

  if (config.dryRun) {
    console.error("[deploy] DRY RUN - would build and deploy container");
    return { image: fullImageName };
  }

  let finalImage = fullImageName;

  // Build container
  if (!config.skipBuild) {
    console.error("\n[deploy] Building container with Kaniko...");

    // Auto-detect Dockerfile (some projects use Dockerfile.api, others use Dockerfile)
    let dockerfilePath = "./Dockerfile";
    const possibleDockerfiles = ["Dockerfile.api", "Dockerfile", "dockerfile", "Dockerfile.backend"];
    for (const df of possibleDockerfiles) {
      if (fs.existsSync(path.join(repoPath, df))) {
        dockerfilePath = `./${df}`;
        console.error(`[deploy] Found Dockerfile: ${dockerfilePath}`);
        break;
      }
    }

    const buildEnv = {
      ...process.env,
      IMAGE_NAME: fullImageName,
      DOCKERFILE_PATH: dockerfilePath,
      CONTEXT_DIR: ".",
      AWS_REGION: config.region,
    };

    const buildResult = spawnSync("node", ["/app/execution-compiled/deploy/build_container.js"], {
      cwd: repoPath,
      encoding: "utf-8",
      env: buildEnv,
      maxBuffer: 50 * 1024 * 1024,
    });

    console.error(buildResult.stdout);
    console.error(buildResult.stderr);

    if (buildResult.status !== 0) {
      throw new Error(`Container build failed with exit code ${buildResult.status}`);
    }

    // Try to extract digest from output
    const digestMatch = (buildResult.stdout + buildResult.stderr).match(/digest:\s*(sha256:[a-f0-9]+)/i);
    if (digestMatch) {
      finalImage = `${config.ecrRepo}@${digestMatch[1]}`;
      console.error(`[deploy] Built image with digest: ${finalImage}`);
    }
  } else {
    console.error("[deploy] Skipping build (--skip-build)");
  }

  // Deploy to ECS
  console.error("\n[deploy] Deploying to ECS...");

  const deployResult = execSafe(
    `${awsCli} ecs update-service --cluster ${config.cluster} --service ${config.service} --force-new-deployment --region ${config.region}`,
    repoPath
  );

  if (deployResult.exitCode !== 0) {
    throw new Error(`ECS deployment failed: ${deployResult.stderr}`);
  }

  // Extract task definition from response
  let taskDefinition: string | undefined;
  try {
    const response = JSON.parse(deployResult.stdout);
    taskDefinition = response.service?.taskDefinition;
  } catch {
    // OK if we can't parse
  }

  console.error("[deploy] ECS deployment initiated");

  // Wait for stabilization
  if (!config.skipWait) {
    console.error("[deploy] Waiting for service to stabilize (up to 5 minutes)...");
    const waitResult = execSafe(
      `${awsCli} ecs wait services-stable --cluster ${config.cluster} --services ${config.service} --region ${config.region}`,
      repoPath
    );

    if (waitResult.exitCode !== 0) {
      console.error("[deploy] WARNING: Service did not stabilize within timeout");
      console.error("[deploy] Deployment may still be in progress");
    } else {
      console.error("[deploy] Service stabilized successfully");
    }
  }

  return { image: finalImage, taskDefinition };
}

async function deployFrontend(
  repoPath: string,
  awsCli: string,
  config: {
    s3Bucket: string;
    cloudfrontDistId: string;
    buildDir: string;
    region: string;
    skipBuild: boolean;
    dryRun: boolean;
  }
): Promise<{ invalidationId?: string; filesUploaded?: number }> {
  console.error("\n========================================");
  console.error("  FRONTEND DEPLOYMENT");
  console.error("========================================\n");

  console.error(`[deploy] S3 Bucket: ${config.s3Bucket}`);
  console.error(`[deploy] CloudFront: ${config.cloudfrontDistId}`);
  console.error(`[deploy] Build Dir: ${config.buildDir}`);

  const frontendDir = path.join(repoPath, "frontend");
  const buildDir = path.resolve(repoPath, config.buildDir);

  if (!fs.existsSync(frontendDir)) {
    throw new Error(`Frontend directory not found: ${frontendDir}`);
  }

  if (config.dryRun) {
    console.error("[deploy] DRY RUN - would build frontend and sync to S3");
    return {};
  }

  // Build frontend
  if (!config.skipBuild) {
    console.error("\n[deploy] Installing dependencies...");
    execSafe("npm ci || npm install", frontendDir);

    console.error("[deploy] Building frontend...");
    const buildResult = execSafe("npm run build", frontendDir);

    if (buildResult.exitCode !== 0) {
      throw new Error(`Frontend build failed: ${buildResult.stderr}`);
    }
    console.error("[deploy] Frontend build complete");
  } else {
    console.error("[deploy] Skipping build (--skip-build)");
  }

  // Verify build output exists
  if (!fs.existsSync(buildDir)) {
    throw new Error(`Build directory not found: ${buildDir}. Did the build succeed?`);
  }

  if (!fs.existsSync(path.join(buildDir, "index.html"))) {
    throw new Error(`index.html not found in ${buildDir}. Build may have failed.`);
  }

  // Sync to S3
  console.error("\n[deploy] Syncing to S3...");
  const syncOutput = exec(
    `${awsCli} s3 sync "${buildDir}" "s3://${config.s3Bucket}/" --delete --region ${config.region}`,
    repoPath
  );

  // Count uploads
  const uploadMatches = syncOutput.match(/upload:/g);
  const filesUploaded = uploadMatches ? uploadMatches.length : 0;
  console.error(`[deploy] Uploaded ${filesUploaded} files`);

  // Invalidate CloudFront
  console.error("\n[deploy] Invalidating CloudFront cache...");
  const invalidationOutput = exec(
    `${awsCli} cloudfront create-invalidation --distribution-id ${config.cloudfrontDistId} --paths "/*" --region ${config.region}`,
    repoPath
  );

  let invalidationId: string | undefined;
  const idMatch = invalidationOutput.match(/"Id":\s*"([^"]+)"/);
  if (idMatch) {
    invalidationId = idMatch[1];
    console.error(`[deploy] CloudFront invalidation created: ${invalidationId}`);
  }

  return { invalidationId, filesUploaded };
}

/**
 * Deploy a static site (pure HTML/CSS/JS) directly to S3
 * No build step required - just sync files
 */
async function deployStaticSite(
  repoPath: string,
  awsCli: string,
  config: {
    s3Bucket: string;
    cloudfrontDistId: string;
    region: string;
    dryRun: boolean;
  }
): Promise<{ invalidationId?: string; filesUploaded?: number }> {
  console.error("\n========================================");
  console.error("  STATIC SITE DEPLOYMENT");
  console.error("========================================\n");

  console.error(`[deploy] S3 Bucket: ${config.s3Bucket}`);
  console.error(`[deploy] CloudFront: ${config.cloudfrontDistId}`);
  console.error(`[deploy] Source: ${repoPath} (root)`);

  // Verify at least index.html exists
  if (!fs.existsSync(path.join(repoPath, "index.html"))) {
    throw new Error(`index.html not found in ${repoPath}. This doesn't appear to be a valid static site.`);
  }

  if (config.dryRun) {
    console.error("[deploy] DRY RUN - would sync static files to S3");
    return {};
  }

  // List files to be synced (exclude git and hidden files)
  const staticFiles = fs.readdirSync(repoPath).filter(f =>
    !f.startsWith(".") && f !== "node_modules" && f !== ".git"
  );
  console.error(`[deploy] Files to sync: ${staticFiles.join(", ")}`);

  // Sync to S3 with exclusions
  console.error("\n[deploy] Syncing static files to S3...");
  const syncOutput = exec(
    `${awsCli} s3 sync "${repoPath}" "s3://${config.s3Bucket}/" --delete --exclude ".git/*" --exclude ".gitignore" --exclude "*.md" --exclude "LICENSE" --region ${config.region}`,
    repoPath
  );

  // Count uploads
  const uploadMatches = syncOutput.match(/upload:/g);
  const filesUploaded = uploadMatches ? uploadMatches.length : 0;
  console.error(`[deploy] Uploaded ${filesUploaded} files`);

  // Invalidate CloudFront
  console.error("\n[deploy] Invalidating CloudFront cache...");
  const invalidationOutput = exec(
    `${awsCli} cloudfront create-invalidation --distribution-id ${config.cloudfrontDistId} --paths "/*" --region ${config.region}`,
    repoPath
  );

  let invalidationId: string | undefined;
  const idMatch = invalidationOutput.match(/"Id":\s*"([^"]+)"/);
  if (idMatch) {
    invalidationId = idMatch[1];
    console.error(`[deploy] CloudFront invalidation created: ${invalidationId}`);
  }

  console.error("\n[deploy] Static site deployment complete!");
  return { invalidationId, filesUploaded };
}

async function main(): Promise<void> {
  const output: Output = {
    success: false,
    backendDeployed: false,
    frontendDeployed: false,
  };

  const options = parseArgs();

  try {
    // Load repository path first
    const repoPath = process.env.REPO_PATH || "/workspace/repo";

    // Load config from .workermill/deploy.json (preferred) or fall back to env vars
    const deployConfig = loadDeployConfig(repoPath);

    // Build effective configuration: config file takes precedence over env vars
    const region = deployConfig?.region || process.env.AWS_REGION || "us-east-1";

    // Frontend config (required for frontend/static deployments)
    const s3Bucket = deployConfig?.frontend?.bucket || process.env.S3_BUCKET || process.env.FRONTEND_BUCKET;
    const cloudfrontDistId = deployConfig?.frontend?.cdnDistributionId || process.env.CLOUDFRONT_DISTRIBUTION_ID || process.env.CDN_DISTRIBUTION_ID;
    const frontendBuildDir = deployConfig?.frontend?.buildDir || process.env.FRONTEND_BUILD_DIR || "./frontend/dist";

    // Backend config (required for backend deployments)
    const ecsCluster = deployConfig?.backend?.ecsCluster || process.env.ECS_CLUSTER || process.env.CLUSTER_NAME;
    const ecsService = deployConfig?.backend?.ecsService || process.env.ECS_SERVICE || process.env.SERVICE_NAME;
    const ecrRepo = deployConfig?.backend?.ecrRepo || process.env.ECR_REPO || process.env.DOCKER_REGISTRY;

    const imageTag = process.env.IMAGE_TAG;

    // Determine repo name for display
    let repoName = "DEPLOYMENT";
    try {
      const remoteUrl = execSync("git config --get remote.origin.url", { cwd: repoPath, encoding: "utf-8" }).trim();
      const match = remoteUrl.match(/\/([^/]+?)(\.git)?$/);
      if (match) repoName = match[1].toUpperCase();
    } catch {
      // Ignore - use default
    }

    console.error("========================================");
    console.error(`  ${repoName} DEPLOYMENT`);
    console.error("========================================\n");

    if (options.dryRun) {
      console.error("*** DRY RUN MODE - No changes will be made ***\n");
      output.dryRun = true;
    }

    // Find AWS CLI
    const awsCli = findAwsCli();
    console.error(`[deploy] AWS CLI: ${awsCli}`);
    console.error(`[deploy] Repository: ${repoPath}`);
    console.error(`[deploy] Region: ${region}`);

    // Determine what to deploy
    let shouldDeployBackend = options.deployBackend;
    let shouldDeployFrontend = options.deployFrontend;
    let shouldDeployStatic = false;

    if (options.autoDetect) {
      const changes = detectChanges(repoPath);
      shouldDeployBackend = changes.backend;
      shouldDeployFrontend = changes.frontend;
      shouldDeployStatic = changes.static;
    }

    console.error(`\n[deploy] Deployment plan:`);
    console.error(`[deploy]   Backend:  ${shouldDeployBackend ? "YES" : "NO"}`);
    console.error(`[deploy]   Frontend: ${shouldDeployFrontend ? "YES" : "NO"}`);
    console.error(`[deploy]   Static:   ${shouldDeployStatic ? "YES" : "NO"}`);

    if (!shouldDeployBackend && !shouldDeployFrontend && !shouldDeployStatic) {
      console.error("\n[deploy] Nothing to deploy. Use --all, --backend, or --frontend to force deployment.");
      output.success = true;
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Validate required configuration exists
    const missingConfig: string[] = [];

    if ((shouldDeployFrontend || shouldDeployStatic) && !s3Bucket) {
      missingConfig.push("frontend.bucket (S3 bucket for frontend/static files)");
    }
    if ((shouldDeployFrontend || shouldDeployStatic) && !cloudfrontDistId) {
      missingConfig.push("frontend.cdnDistributionId (CloudFront distribution ID)");
    }
    if (shouldDeployBackend && !ecsCluster) {
      missingConfig.push("backend.ecsCluster (ECS cluster name)");
    }
    if (shouldDeployBackend && !ecsService) {
      missingConfig.push("backend.ecsService (ECS service name)");
    }
    if (shouldDeployBackend && !ecrRepo) {
      missingConfig.push("backend.ecrRepo (ECR repository URL)");
    }

    if (missingConfig.length > 0) {
      console.error("\n[deploy] ERROR: Missing required deployment configuration!");
      console.error("[deploy] Create a .workermill/deploy.json file in the repository with:");
      for (const missing of missingConfig) {
        console.error(`[deploy]   - ${missing}`);
      }
      console.error("\n[deploy] Example .workermill/deploy.json:");
      console.error(JSON.stringify({
        version: "1",
        region: "us-east-1",
        frontend: {
          bucket: "my-frontend-bucket",
          cdnDistributionId: "EXXXXXXXXXX",
        },
        backend: {
          ecrRepo: "123456789.dkr.ecr.us-east-1.amazonaws.com/my-app",
          ecsCluster: "my-cluster",
          ecsService: "my-service",
        },
      }, null, 2));
      throw new Error(`Missing deployment configuration: ${missingConfig.join(", ")}`);
    }

    // Handle static site deployment (mutually exclusive with backend/frontend)
    if (shouldDeployStatic) {
      const staticResult = await deployStaticSite(repoPath, awsCli, {
        s3Bucket: s3Bucket!, // Validated above
        cloudfrontDistId: cloudfrontDistId!, // Validated above
        region: region,
        dryRun: options.dryRun,
      });

      output.staticSiteDeployed = !options.dryRun;
      output.cloudfrontInvalidationId = staticResult.invalidationId;
      output.filesUploaded = staticResult.filesUploaded;
      output.success = true;

      console.error("\n========================================");
      console.error("  DEPLOYMENT COMPLETE");
      console.error("========================================\n");

      if (output.staticSiteDeployed) {
        console.error(`[deploy] Static site: s3://${s3Bucket}`);
        console.error(`[deploy] CloudFront invalidation: ${output.cloudfrontInvalidationId}`);
      }

      // Output JSON result
      console.log(JSON.stringify(output, null, 2));

      // Output markers for orchestrator
      if (output.success && !output.dryRun) {
        console.error("\n::result::deployed");
        if (output.cloudfrontInvalidationId) {
          console.error(`::cloudfront_invalidation::${output.cloudfrontInvalidationId}`);
        }
      }

      process.exit(0);
      return;
    }

    // Deploy backend first (if frontend depends on new API endpoints)
    if (shouldDeployBackend) {
      const backendResult = await deployBackend(repoPath, awsCli, {
        cluster: ecsCluster!, // Validated above
        service: ecsService!, // Validated above
        ecrRepo: ecrRepo!, // Validated above
        region: region,
        imageTag: imageTag,
        skipBuild: options.skipBuild,
        skipWait: options.skipWait,
        dryRun: options.dryRun,
      });

      output.backendDeployed = !options.dryRun;
      output.backendImage = backendResult.image;
      output.ecsTaskDefinition = backendResult.taskDefinition;
    }

    // Deploy frontend
    if (shouldDeployFrontend) {
      const frontendResult = await deployFrontend(repoPath, awsCli, {
        s3Bucket: s3Bucket!, // Validated above
        cloudfrontDistId: cloudfrontDistId!, // Validated above
        buildDir: frontendBuildDir,
        region: region,
        skipBuild: options.skipBuild,
        dryRun: options.dryRun,
      });

      output.frontendDeployed = !options.dryRun;
      output.cloudfrontInvalidationId = frontendResult.invalidationId;
      output.filesUploaded = frontendResult.filesUploaded;
    }

    output.success = true;

    console.error("\n========================================");
    console.error("  DEPLOYMENT COMPLETE");
    console.error("========================================\n");

    if (output.backendDeployed) {
      console.error(`[deploy] Backend: ${output.backendImage}`);
    }
    if (output.frontendDeployed) {
      console.error(`[deploy] Frontend: s3://${s3Bucket}`);
      console.error(`[deploy] CloudFront invalidation: ${output.cloudfrontInvalidationId}`);
    }

  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
    console.error(`\n[deploy] ERROR: ${output.error}`);
  }

  // Output JSON result
  console.log(JSON.stringify(output, null, 2));

  // Output markers for orchestrator
  if (output.success && !output.dryRun) {
    console.error("\n::result::deployed");
    if (output.backendDeployed) {
      console.error(`::backend_image::${output.backendImage}`);
    }
    if (output.frontendDeployed && output.cloudfrontInvalidationId) {
      console.error(`::cloudfront_invalidation::${output.cloudfrontInvalidationId}`);
    }
  }

  process.exit(output.success ? 0 : 1);
}

main();
