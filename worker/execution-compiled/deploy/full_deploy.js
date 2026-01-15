***REMOVED***!/usr/bin/env npx ts-node
"use strict";
/**
 * Full-Stack Deployment Script for AI Agents
 *
 * A unified deployment script that handles backend and frontend deployments
 * for oncallshift (pagerduty-lite).
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
 * Environment variables (optional overrides):
 *   REPO_PATH                    Path to repository (default: /workspace/repo)
 *   AWS_REGION                   AWS region (default: us-east-1)
 *   ECS_CLUSTER                  ECS cluster name (default: pagerduty-lite-dev)
 *   ECS_SERVICE                  ECS service name (default: pagerduty-lite-dev-api)
 *   ECR_REPO                     ECR repository URL
 *   S3_BUCKET                    S3 bucket for frontend (default: oncallshift-dev-web)
 *   CLOUDFRONT_DISTRIBUTION_ID   CloudFront distribution (default: E7BQGD7BWAB8B)
 *   FRONTEND_BUILD_DIR           Frontend build output (default: ./frontend/dist)
 *   IMAGE_TAG                    Override image tag (default: git commit hash)
 *
 * Examples:
 *   ***REMOVED*** Deploy everything (auto-detect changes)
 *   node /app/execution-compiled/deploy/full_deploy.js
 *
 *   ***REMOVED*** Deploy backend only
 *   node /app/execution-compiled/deploy/full_deploy.js --backend
 *
 *   ***REMOVED*** Deploy frontend only
 *   node /app/execution-compiled/deploy/full_deploy.js --frontend
 *
 *   ***REMOVED*** Deploy both
 *   node /app/execution-compiled/deploy/full_deploy.js --all
 *
 *   ***REMOVED*** Dry run to see what would happen
 *   node /app/execution-compiled/deploy/full_deploy.js --all --dry-run
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Parse command-line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
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
function printHelp() {
    console.log(`
Full-Stack Deployment Script for Oncallshift

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

Environment Variables:
  REPO_PATH                    Repository path (default: /workspace/repo)
  AWS_REGION                   AWS region (default: us-east-1)
  ECS_CLUSTER                  ECS cluster (default: pagerduty-lite-dev)
  ECS_SERVICE                  ECS service (default: pagerduty-lite-dev-api)
  S3_BUCKET                    S3 bucket (default: oncallshift-dev-web)
  CLOUDFRONT_DISTRIBUTION_ID   CloudFront ID (default: E7BQGD7BWAB8B)
  IMAGE_TAG                    Override image tag (default: git commit hash)

Examples:
  ***REMOVED*** Auto-detect and deploy what changed
  node full_deploy.js

  ***REMOVED*** Deploy backend only
  node full_deploy.js --backend

  ***REMOVED*** Deploy frontend only
  node full_deploy.js --frontend

  ***REMOVED*** Deploy everything
  node full_deploy.js --all

  ***REMOVED*** See what would happen without deploying
  node full_deploy.js --all --dry-run
`);
}
// Find AWS CLI in various locations
function findAwsCli() {
    const paths = [
        "/usr/local/bin/aws",
        "/usr/bin/aws",
        "aws",
    ];
    for (const awsPath of paths) {
        try {
            (0, child_process_1.execSync)(`${awsPath} --version`, { stdio: "pipe" });
            return awsPath;
        }
        catch {
            // Try next
        }
    }
    // Try with sudo
    try {
        (0, child_process_1.execSync)("sudo /usr/local/bin/aws --version", { stdio: "pipe" });
        return "sudo /usr/local/bin/aws";
    }
    catch {
        // Continue
    }
    throw new Error("AWS CLI not found in any known location");
}
function exec(cmd, cwd) {
    console.error(`[deploy] $ ${cmd}`);
    return (0, child_process_1.execSync)(cmd, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 50 * 1024 * 1024,
    }).trim();
}
function execSafe(cmd, cwd) {
    console.error(`[deploy] $ ${cmd}`);
    const result = (0, child_process_1.spawnSync)("sh", ["-c", cmd], {
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
function detectChanges(repoPath) {
    console.error("[deploy] Auto-detecting changes...");
    try {
        // Try to get diff against main/origin
        let changedFiles = [];
        try {
            changedFiles = exec("git diff --name-only origin/main...HEAD", repoPath)
                .split("\n").filter(f => f.trim());
        }
        catch {
            try {
                changedFiles = exec("git diff --name-only main...HEAD", repoPath)
                    .split("\n").filter(f => f.trim());
            }
            catch {
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
            // Frontend patterns
            if (file.startsWith("frontend/") ||
                file.match(/\.(tsx|jsx|css|scss|sass|less)$/) ||
                file.includes("tailwind") ||
                file.includes("vite") ||
                file.includes("webpack")) {
                frontend = true;
            }
            // Backend patterns
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
        // If no specific detection, default based on repo structure
        if (!backend && !frontend && changedFiles.length > 0) {
            console.error("[deploy] Could not classify changes, deploying both to be safe");
            backend = true;
            frontend = fs.existsSync(path.join(repoPath, "frontend"));
        }
        console.error(`[deploy] Detected changes: backend=${backend}, frontend=${frontend}`);
        return { backend, frontend };
    }
    catch (error) {
        console.error("[deploy] Change detection failed, assuming both need deployment");
        return { backend: true, frontend: true };
    }
}
async function deployBackend(repoPath, awsCli, config) {
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
        // Auto-detect Dockerfile (oncallshift uses Dockerfile.api, others use Dockerfile)
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
        const buildResult = (0, child_process_1.spawnSync)("node", ["/app/execution-compiled/deploy/build_container.js"], {
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
    }
    else {
        console.error("[deploy] Skipping build (--skip-build)");
    }
    // Deploy to ECS
    console.error("\n[deploy] Deploying to ECS...");
    const deployResult = execSafe(`${awsCli} ecs update-service --cluster ${config.cluster} --service ${config.service} --force-new-deployment --region ${config.region}`, repoPath);
    if (deployResult.exitCode !== 0) {
        throw new Error(`ECS deployment failed: ${deployResult.stderr}`);
    }
    // Extract task definition from response
    let taskDefinition;
    try {
        const response = JSON.parse(deployResult.stdout);
        taskDefinition = response.service?.taskDefinition;
    }
    catch {
        // OK if we can't parse
    }
    console.error("[deploy] ECS deployment initiated");
    // Wait for stabilization
    if (!config.skipWait) {
        console.error("[deploy] Waiting for service to stabilize (up to 5 minutes)...");
        const waitResult = execSafe(`${awsCli} ecs wait services-stable --cluster ${config.cluster} --services ${config.service} --region ${config.region}`, repoPath);
        if (waitResult.exitCode !== 0) {
            console.error("[deploy] WARNING: Service did not stabilize within timeout");
            console.error("[deploy] Deployment may still be in progress");
        }
        else {
            console.error("[deploy] Service stabilized successfully");
        }
    }
    return { image: finalImage, taskDefinition };
}
async function deployFrontend(repoPath, awsCli, config) {
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
    }
    else {
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
    const syncOutput = exec(`${awsCli} s3 sync "${buildDir}" "s3://${config.s3Bucket}/" --delete --region ${config.region}`, repoPath);
    // Count uploads
    const uploadMatches = syncOutput.match(/upload:/g);
    const filesUploaded = uploadMatches ? uploadMatches.length : 0;
    console.error(`[deploy] Uploaded ${filesUploaded} files`);
    // Invalidate CloudFront
    console.error("\n[deploy] Invalidating CloudFront cache...");
    const invalidationOutput = exec(`${awsCli} cloudfront create-invalidation --distribution-id ${config.cloudfrontDistId} --paths "/*" --region ${config.region}`, repoPath);
    let invalidationId;
    const idMatch = invalidationOutput.match(/"Id":\s*"([^"]+)"/);
    if (idMatch) {
        invalidationId = idMatch[1];
        console.error(`[deploy] CloudFront invalidation created: ${invalidationId}`);
    }
    return { invalidationId, filesUploaded };
}
async function main() {
    const output = {
        success: false,
        backendDeployed: false,
        frontendDeployed: false,
    };
    const options = parseArgs();
    try {
        // Configuration with oncallshift defaults
        const repoPath = process.env.REPO_PATH || "/workspace/repo";
        const region = process.env.AWS_REGION || "us-east-1";
        const ecsCluster = process.env.ECS_CLUSTER || "pagerduty-lite-dev";
        const ecsService = process.env.ECS_SERVICE || "pagerduty-lite-dev-api";
        const ecrRepo = process.env.ECR_REPO || "AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/pagerduty-lite-dev-api";
        const s3Bucket = process.env.S3_BUCKET || "oncallshift-dev-web";
        const cloudfrontDistId = process.env.CLOUDFRONT_DISTRIBUTION_ID || "E7BQGD7BWAB8B";
        const frontendBuildDir = process.env.FRONTEND_BUILD_DIR || "./frontend/dist";
        const imageTag = process.env.IMAGE_TAG;
        console.error("========================================");
        console.error("  ONCALLSHIFT DEPLOYMENT");
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
        if (options.autoDetect) {
            const changes = detectChanges(repoPath);
            shouldDeployBackend = changes.backend;
            shouldDeployFrontend = changes.frontend;
        }
        console.error(`\n[deploy] Deployment plan:`);
        console.error(`[deploy]   Backend:  ${shouldDeployBackend ? "YES" : "NO"}`);
        console.error(`[deploy]   Frontend: ${shouldDeployFrontend ? "YES" : "NO"}`);
        if (!shouldDeployBackend && !shouldDeployFrontend) {
            console.error("\n[deploy] Nothing to deploy. Use --all, --backend, or --frontend to force deployment.");
            output.success = true;
            console.log(JSON.stringify(output, null, 2));
            return;
        }
        // Deploy backend first (if frontend depends on new API endpoints)
        if (shouldDeployBackend) {
            const backendResult = await deployBackend(repoPath, awsCli, {
                cluster: ecsCluster,
                service: ecsService,
                ecrRepo: ecrRepo,
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
                s3Bucket: s3Bucket,
                cloudfrontDistId: cloudfrontDistId,
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
    }
    catch (error) {
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
