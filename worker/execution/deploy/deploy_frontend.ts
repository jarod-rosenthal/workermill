***REMOVED***!/usr/bin/env npx ts-node

/**
 * Deploy frontend to S3 and invalidate CloudFront
 *
 * Inputs (environment variables):
 * - BUILD_DIR: Required. Path to the built frontend (e.g., "./dist" or "./frontend/dist")
 * - S3_BUCKET: Required. Target S3 bucket name (e.g., "oncallshift-dev-web")
 * - CLOUDFRONT_DISTRIBUTION_ID: Optional. CloudFront distribution ID to invalidate
 * - AWS_REGION: Optional. AWS region (defaults to us-east-1)
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - filesUploaded: number
 * - s3Bucket: string
 * - cloudfrontInvalidationId?: string
 * - error?: string
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface Output {
  success: boolean;
  filesUploaded?: number;
  s3Bucket?: string;
  cloudfrontInvalidationId?: string;
  error?: string;
}

function exec(cmd: string, cwd?: string): string {
  console.error(`[deploy_frontend] Running: ${cmd}`);
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function main(): Promise<void> {
  const output: Output = { success: false };

  try {
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

    // Sync to S3
    console.error(`[deploy_frontend] Syncing ${absoluteBuildDir} to s3://${s3Bucket}/`);
    const syncOutput = exec(
      `aws s3 sync "${absoluteBuildDir}" "s3://${s3Bucket}/" --delete --region ${region}`,
      process.cwd()
    );

    // Count files from sync output
    const uploadMatches = syncOutput.match(/upload:/g);
    output.filesUploaded = uploadMatches ? uploadMatches.length : 0;
    console.error(`[deploy_frontend] Uploaded ${output.filesUploaded} files`);

    // Invalidate CloudFront if distribution ID provided
    if (cloudfrontDistId) {
      console.error(`[deploy_frontend] Invalidating CloudFront distribution ${cloudfrontDistId}`);
      const invalidationOutput = exec(
        `aws cloudfront create-invalidation --distribution-id ${cloudfrontDistId} --paths "/*" --region ${region}`,
        process.cwd()
      );

      // Extract invalidation ID
      const idMatch = invalidationOutput.match(/"Id":\s*"([^"]+)"/);
      if (idMatch) {
        output.cloudfrontInvalidationId = idMatch[1];
        console.error(`[deploy_frontend] CloudFront invalidation ID: ${output.cloudfrontInvalidationId}`);
      }
    } else {
      console.error(`[deploy_frontend] No CloudFront distribution ID provided, skipping invalidation`);
    }

    output.success = true;
  } catch (error: unknown) {
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
