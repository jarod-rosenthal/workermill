#!/usr/bin/env npx ts-node
"use strict";
/**
 * Add a comment to a ticket (supports Jira, Linear, GitHub Issues)
 *
 * Inputs (environment variables):
 * - TICKET_KEY: Required. The ticket key (e.g., "PROJ-123")
 * - COMMENT: Required. The comment text
 * - TICKET_SYSTEM: Optional. "jira" (default), "linear", or "github"
 *
 * For Jira:
 * - JIRA_BASE_URL: Required. Jira instance URL
 * - JIRA_EMAIL: Required. Jira user email
 * - JIRA_API_TOKEN: Required. Jira API token
 *
 * For GitHub:
 * - GITHUB_REPO: Required. "owner/repo" format
 * - GITHUB_TOKEN: Required. GitHub token
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - commentId: string
 * - commentUrl: string
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
const https = __importStar(require("https"));
const http = __importStar(require("http"));
function makeRequest(url, options, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === "https:" ? https : http;
        const req = protocol.request(url, options, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });
            res.on("end", () => {
                resolve({ statusCode: res.statusCode || 0, body: data });
            });
        });
        req.on("error", reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}
function textToJiraAdf(text) {
    // URL regex to detect http/https URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const paragraphs = text.split("\n\n").map((para) => {
        const lineText = para.replace(/\n/g, " ");
        const content = [];
        // Split text by URLs and create appropriate ADF nodes
        let lastIndex = 0;
        let match;
        while ((match = urlRegex.exec(lineText)) !== null) {
            // Add text before the URL
            if (match.index > lastIndex) {
                content.push({
                    type: "text",
                    text: lineText.slice(lastIndex, match.index),
                });
            }
            // Add URL as an inlineCard (smart link) for rich display
            // This shows PR title, status, and other metadata in Jira
            content.push({
                type: "inlineCard",
                attrs: {
                    url: match[1],
                },
            });
            lastIndex = match.index + match[0].length;
        }
        // Add remaining text after the last URL
        if (lastIndex < lineText.length) {
            content.push({
                type: "text",
                text: lineText.slice(lastIndex),
            });
        }
        // If no URLs found, just use plain text
        if (content.length === 0) {
            content.push({
                type: "text",
                text: lineText,
            });
        }
        return {
            type: "paragraph",
            content,
        };
    });
    return {
        type: "doc",
        version: 1,
        content: paragraphs,
    };
}
async function addJiraComment(ticketKey, comment) {
    const jiraBaseUrl = process.env.JIRA_BASE_URL;
    const jiraEmail = process.env.JIRA_EMAIL;
    const jiraApiToken = process.env.JIRA_API_TOKEN;
    if (!jiraBaseUrl)
        throw new Error("JIRA_BASE_URL is required");
    if (!jiraEmail)
        throw new Error("JIRA_EMAIL is required");
    if (!jiraApiToken)
        throw new Error("JIRA_API_TOKEN is required");
    const apiUrl = `${jiraBaseUrl}/rest/api/3/issue/${ticketKey}/comment`;
    const authString = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString("base64");
    const requestBody = JSON.stringify({ body: textToJiraAdf(comment) });
    const response = await makeRequest(apiUrl, {
        method: "POST",
        headers: {
            Authorization: `Basic ${authString}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "Content-Length": Buffer.byteLength(requestBody),
        },
    }, requestBody);
    if (response.statusCode === 201 || response.statusCode === 200) {
        const data = JSON.parse(response.body);
        return {
            success: true,
            commentId: data.id,
            commentUrl: `${jiraBaseUrl}/browse/${ticketKey}?focusedCommentId=${data.id}`,
        };
    }
    throw new Error(`Jira API returned ${response.statusCode}: ${response.body.slice(0, 200)}`);
}
async function addGithubComment(issueNumber, comment) {
    const githubRepo = process.env.GITHUB_REPO;
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubRepo)
        throw new Error("GITHUB_REPO is required");
    if (!githubToken)
        throw new Error("GITHUB_TOKEN is required");
    const apiUrl = `https://api.github.com/repos/${githubRepo}/issues/${issueNumber}/comments`;
    const requestBody = JSON.stringify({ body: comment });
    const response = await makeRequest(apiUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${githubToken}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github+json",
            "User-Agent": "WorkerMill-AI-Worker",
            "Content-Length": Buffer.byteLength(requestBody),
        },
    }, requestBody);
    if (response.statusCode === 201) {
        const data = JSON.parse(response.body);
        return {
            success: true,
            commentId: String(data.id),
            commentUrl: data.html_url,
        };
    }
    throw new Error(`GitHub API returned ${response.statusCode}: ${response.body.slice(0, 200)}`);
}
async function main() {
    const output = { success: false };
    try {
        const ticketKey = process.env.TICKET_KEY;
        // Convert literal \n sequences to actual newlines
        // AI agents sometimes output "\n" as literal characters instead of actual newlines
        const rawComment = process.env.COMMENT;
        const comment = rawComment?.replace(/\\n/g, "\n");
        const ticketSystem = process.env.TICKET_SYSTEM || "jira";
        if (!ticketKey)
            throw new Error("TICKET_KEY is required");
        if (!comment)
            throw new Error("COMMENT is required");
        // For child tasks with synthetic keys (e.g., OCS-408-S1), use parent Jira key
        const parentJiraKey = process.env.PARENT_JIRA_KEY;
        const effectiveTicketKey = parentJiraKey || ticketKey;
        if (parentJiraKey) {
            console.error(`[add_comment] Child task detected - using parent ticket ${effectiveTicketKey} (task key: ${ticketKey})`);
        }
        let result;
        switch (ticketSystem.toLowerCase()) {
            case "jira":
                result = await addJiraComment(effectiveTicketKey, comment);
                break;
            case "github":
                // Extract issue number from key (e.g., "#123" or "123")
                const issueNumber = ticketKey.replace(/^#/, "");
                result = await addGithubComment(issueNumber, comment);
                break;
            default:
                throw new Error(`Unsupported ticket system: ${ticketSystem}`);
        }
        Object.assign(output, result);
    }
    catch (error) {
        output.error = error instanceof Error ? error.message : String(error);
        output.success = false;
    }
    console.log(JSON.stringify(output));
    process.exit(output.success ? 0 : 1);
}
main();
