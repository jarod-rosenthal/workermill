#!/usr/bin/env npx ts-node
"use strict";
/**
 * Deploy frontend to S3 and invalidate CloudFront
 *
 * Inputs (environment variables):
 * - BUILD_DIR: Required. Path to the built frontend (e.g., "./dist" or "./frontend/dist")
 * - S3_BUCKET: Required. Target S3 bucket name (e.g., "my-app-frontend")
 * - CLOUDFRONT_DISTRIBUTION_ID: Optional. CloudFront distribution ID to invalidate
 * - AWS_REGION: Optional. AWS region (defaults to us-east-1)
 *
 * Customer AWS Configuration (optional - for cross-account deployments):
 * - CUSTOMER_AWS_ROLE_ARN: Customer's IAM role to assume for deployments
 * - CUSTOMER_AWS_EXTERNAL_ID: External ID for role assumption
 * - CUSTOMER_AWS_REGION: Customer's AWS region (overrides AWS_REGION)
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - filesUploaded: number
 * - s3Bucket: string
 * - cloudfrontInvalidationId?: string
 * - error?: string
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
const cloud_credentials_js_1 = require("../lib/cloud-credentials.js");
// Find AWS CLI - try multiple locations
function findAwsCli() {
    const paths = [
        "/usr/local/bin/aws", // Standard AWS CLI v2 location
        "/usr/bin/aws", // Some distros
        "aws", // In PATH
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
    // If no direct access, try with sudo
    try {
        (0, child_process_1.execSync)("sudo /usr/local/bin/aws --version", { stdio: "pipe" });
        return "sudo /usr/local/bin/aws";
    }
    catch {
        // Continue
    }
    throw new Error("AWS CLI not found");
}
function exec(cmd, cwd) {
    console.error(`[deploy_frontend] Running: ${cmd}`);
    return (0, child_process_1.execSync)(cmd, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
    }).trim();
}
async function main() {
    const output = { success: false };
    try {
        // If customer AWS credentials are configured, assume the customer's IAM role
        if ((0, cloud_credentials_js_1.hasCustomerAwsConfig)()) {
            console.error("[deploy_frontend] Customer AWS role configured, assuming role...");
            await (0, cloud_credentials_js_1.setCustomerAwsEnvVars)();
            console.error("[deploy_frontend] Now using customer AWS credentials for deployment");
        }
        const buildDir = process.env.BUILD_DIR;
        const s3Bucket = process.env.S3_BUCKET;
        const cloudfrontDistId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
        const region = process.env.AWS_REGION || "us-east-1";
        if (!buildDir) {
            throw new Error("BUILD_DIR environment variable is required");
        }
        if (!s3Bucket) {
            throw new Error("S3_BUCKET environment variable is required");
        }
        // Verify build directory exists
        const absoluteBuildDir = path.resolve(buildDir);
        if (!fs.existsSync(absoluteBuildDir)) {
            throw new Error(`Build directory not found: ${absoluteBuildDir}`);
        }
        // Check for index.html as a sanity check
        const indexPath = path.join(absoluteBuildDir, "index.html");
        if (!fs.existsSync(indexPath)) {
            throw new Error(`index.html not found in build directory. Did the build complete?`);
        }
        output.s3Bucket = s3Bucket;
        // Find AWS CLI
        const awsCli = findAwsCli();
        console.error(`[deploy_frontend] Using AWS CLI: ${awsCli}`);
        // Sync to S3
        console.error(`[deploy_frontend] Syncing ${absoluteBuildDir} to s3://${s3Bucket}/`);
        const syncOutput = exec(`${awsCli} s3 sync "${absoluteBuildDir}" "s3://${s3Bucket}/" --delete --region ${region}`, process.cwd());
        // Count files from sync output
        const uploadMatches = syncOutput.match(/upload:/g);
        output.filesUploaded = uploadMatches ? uploadMatches.length : 0;
        console.error(`[deploy_frontend] Uploaded ${output.filesUploaded} files`);
        // Invalidate CloudFront if distribution ID provided
        if (cloudfrontDistId) {
            console.error(`[deploy_frontend] Invalidating CloudFront distribution ${cloudfrontDistId}`);
            const invalidationOutput = exec(`${awsCli} cloudfront create-invalidation --distribution-id ${cloudfrontDistId} --paths "/*" --region ${region}`, process.cwd());
            // Extract invalidation ID
            const idMatch = invalidationOutput.match(/"Id":\s*"([^"]+)"/);
            if (idMatch) {
                output.cloudfrontInvalidationId = idMatch[1];
                console.error(`[deploy_frontend] CloudFront invalidation ID: ${output.cloudfrontInvalidationId}`);
            }
        }
        else {
            console.error(`[deploy_frontend] No CloudFront distribution ID provided, skipping invalidation`);
        }
        output.success = true;
    }
    catch (error) {
        output.error = error instanceof Error ? error.message : String(error);
        console.error(`[deploy_frontend] Error: ${output.error}`);
    }
    console.log(JSON.stringify(output));
    // Output markers for orchestrator
    if (output.success) {
        console.error(`::result::frontend_deployed`);
        console.error(`::s3_bucket::${output.s3Bucket}`);
        if (output.cloudfrontInvalidationId) {
            console.error(`::cloudfront_invalidation::${output.cloudfrontInvalidationId}`);
        }
    }
    process.exit(output.success ? 0 : 1);
}
main();
