"use strict";
/**
 * Check deployment health endpoint
 *
 * Polls a health endpoint until it returns 200 OK, with configurable
 * retries and intervals.
 *
 * Environment variables:
 * - HEALTH_CHECK_URL: URL to check (required)
 * - HEALTH_CHECK_RETRIES: Number of retries (default: 10)
 * - HEALTH_CHECK_INTERVAL: Seconds between retries (default: 30)
 * - HEALTH_CHECK_TIMEOUT: Request timeout in seconds (default: 10)
 * - EXPECTED_VERSION: Expected version string to match (optional)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const urlEnv = process.env.HEALTH_CHECK_URL;
const maxRetries = parseInt(process.env.HEALTH_CHECK_RETRIES || "10");
const interval = parseInt(process.env.HEALTH_CHECK_INTERVAL || "30") * 1000;
const timeout = parseInt(process.env.HEALTH_CHECK_TIMEOUT || "10") * 1000;
const expectedVersion = process.env.EXPECTED_VERSION;
if (!urlEnv) {
    console.error("ERROR: HEALTH_CHECK_URL environment variable not set");
    console.error("Example: https://api.example.com/health");
    process.exit(1);
}
// TypeScript knows url is defined after the check above
const url = urlEnv;
console.log("=== Health Check ===");
console.log(`URL: ${url}`);
console.log(`Max retries: ${maxRetries}`);
console.log(`Interval: ${interval / 1000}s`);
console.log(`Timeout: ${timeout / 1000}s`);
if (expectedVersion) {
    console.log(`Expected version: ${expectedVersion}`);
}
console.log("");
async function checkHealth() {
    return new Promise((resolve) => {
        const client = url.startsWith("https") ? https_1.default : http_1.default;
        const req = client.get(url, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });
            res.on("end", () => {
                if (res.statusCode !== 200) {
                    resolve({
                        healthy: false,
                        error: `HTTP ${res.statusCode}: ${res.statusMessage}`,
                    });
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    // Check for common health indicators
                    const isHealthy = json.status === "healthy" ||
                        json.status === "ok" ||
                        json.healthy === true ||
                        json.ok === true ||
                        res.statusCode === 200;
                    // Check version if expected
                    if (expectedVersion && json.version !== expectedVersion) {
                        resolve({
                            healthy: false,
                            response: json,
                            error: `Version mismatch: expected ${expectedVersion}, got ${json.version}`,
                        });
                        return;
                    }
                    resolve({ healthy: isHealthy, response: json });
                }
                catch {
                    // Non-JSON response, just check status code
                    resolve({ healthy: res.statusCode === 200 });
                }
            });
        });
        req.on("error", (err) => {
            resolve({ healthy: false, error: err.message });
        });
        req.setTimeout(timeout, () => {
            req.destroy();
            resolve({ healthy: false, error: "Request timeout" });
        });
    });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function main() {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`Attempt ${attempt}/${maxRetries}...`);
        const result = await checkHealth();
        if (result.healthy) {
            console.log("");
            console.log("=== Health Check Passed ===");
            if (result.response) {
                console.log("Response:", JSON.stringify(result.response, null, 2));
            }
            console.log("");
            console.log("::health_check::passed");
            if (result.response?.version) {
                console.log(`::deployed_version::${result.response.version}`);
            }
            process.exit(0);
        }
        console.log(`  Failed: ${result.error || "Unknown error"}`);
        if (attempt < maxRetries) {
            console.log(`  Waiting ${interval / 1000}s before next attempt...`);
            await sleep(interval);
        }
    }
    console.log("");
    console.error("=== Health Check Failed ===");
    console.error(`Endpoint ${url} did not become healthy after ${maxRetries} attempts`);
    console.log("");
    console.log("::health_check::failed");
    process.exit(1);
}
main().catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
});
