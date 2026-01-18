#!/usr/bin/env npx ts-node
"use strict";
/**
 * Fetch Jira ticket attachments and save to local directory
 *
 * Inputs (environment variables):
 * - TICKET_KEY: Required. The Jira ticket key (e.g., "OCS-123")
 * - PARENT_JIRA_KEY: Optional. For child tasks with synthetic keys (e.g., "OCS-123-S1"),
 *   use this to fetch attachments from the parent ticket
 * - JIRA_BASE_URL: Required. Jira instance URL (e.g., "https://company.atlassian.net")
 * - JIRA_EMAIL: Required. Jira user email
 * - JIRA_API_TOKEN: Required. Jira API token
 * - OUTPUT_DIR: Optional. Directory to save attachments (defaults to /tmp/attachments)
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - attachments: array of { filename, path, mimeType, size }
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const https = __importStar(require("https"));
function fetchJson(url, auth) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: "GET",
            headers: {
                Authorization: `Basic ${auth}`,
                Accept: "application/json",
            },
        };
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        reject(new Error(`Invalid JSON response: ${data.substring(0, 100)}`));
                    }
                }
                else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });
        req.on("error", reject);
        req.end();
    });
}
function downloadFile(url, auth, outputPath) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const headers = {};
        // Only include auth header if auth is provided
        // (redirect URLs to signed storage don't need auth)
        if (auth) {
            headers.Authorization = `Basic ${auth}`;
        }
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: "GET",
            headers,
        };
        const req = https.request(options, (res) => {
            // Handle redirects (301, 302, 303, 307, 308)
            // Jira attachment API commonly returns 303 (See Other)
            if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    // For 303, Jira redirects to a signed S3 URL that doesn't need auth
                    const needsAuth = res.statusCode !== 303;
                    downloadFile(redirectUrl, needsAuth ? auth : "", outputPath).then(resolve).catch(reject);
                    return;
                }
            }
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                const file = fs.createWriteStream(outputPath);
                res.pipe(file);
                file.on("finish", () => {
                    file.close();
                    resolve();
                });
                file.on("error", reject);
            }
            else {
                reject(new Error(`HTTP ${res.statusCode} downloading attachment`));
            }
        });
        req.on("error", reject);
        req.end();
    });
}
async function main() {
    const output = { success: false };
    try {
        const ticketKey = process.env.TICKET_KEY;
        const parentJiraKey = process.env.PARENT_JIRA_KEY;
        const jiraBaseUrl = process.env.JIRA_BASE_URL;
        const jiraEmail = process.env.JIRA_EMAIL;
        const jiraApiToken = process.env.JIRA_API_TOKEN;
        const outputDir = process.env.OUTPUT_DIR || "/tmp/attachments";
        if (!ticketKey)
            throw new Error("TICKET_KEY is required");
        // For child tasks with synthetic keys (e.g., OCS-123-S1), use the parent's Jira key
        // since synthetic keys don't exist in Jira
        const effectiveTicketKey = parentJiraKey || ticketKey;
        if (!jiraBaseUrl)
            throw new Error("JIRA_BASE_URL is required");
        if (!jiraEmail)
            throw new Error("JIRA_EMAIL is required");
        if (!jiraApiToken)
            throw new Error("JIRA_API_TOKEN is required");
        // Create output directory
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        output.outputDir = outputDir;
        // Create auth header
        const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString("base64");
        // Fetch ticket with attachments
        if (parentJiraKey) {
            console.error(`[fetch_attachments] Child task detected - using parent ticket ${effectiveTicketKey} (task key: ${ticketKey})`);
        }
        console.error(`[fetch_attachments] Fetching attachments for ${effectiveTicketKey}`);
        const issueUrl = `${jiraBaseUrl}/rest/api/3/issue/${effectiveTicketKey}?fields=attachment`;
        const issueData = await fetchJson(issueUrl, auth);
        const jiraAttachments = issueData.fields?.attachment || [];
        if (jiraAttachments.length === 0) {
            console.error(`[fetch_attachments] No attachments found on ${effectiveTicketKey}`);
            output.success = true;
            output.attachments = [];
            console.log(JSON.stringify(output));
            process.exit(0);
        }
        console.error(`[fetch_attachments] Found ${jiraAttachments.length} attachments`);
        // Download each attachment
        const attachments = [];
        for (const att of jiraAttachments) {
            const outputPath = path.join(outputDir, att.filename);
            console.error(`[fetch_attachments] Downloading: ${att.filename} (${att.mimeType})`);
            try {
                await downloadFile(att.content, auth, outputPath);
                attachments.push({
                    id: att.id,
                    filename: att.filename,
                    path: outputPath,
                    mimeType: att.mimeType,
                    size: att.size,
                });
                console.error(`[fetch_attachments] Saved to: ${outputPath}`);
            }
            catch (err) {
                console.error(`[fetch_attachments] Failed to download ${att.filename}: ${err}`);
            }
        }
        output.attachments = attachments;
        output.success = true;
    }
    catch (error) {
        output.error = error instanceof Error ? error.message : String(error);
        console.error(`[fetch_attachments] Error: ${output.error}`);
    }
    console.log(JSON.stringify(output));
    // Output markers
    if (output.success && output.attachments) {
        console.error(`::attachments_count::${output.attachments.length}`);
        for (const att of output.attachments) {
            console.error(`::attachment::${att.path}`);
        }
    }
    process.exit(output.success ? 0 : 1);
}
main();
