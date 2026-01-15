***REMOVED***!/usr/bin/env npx ts-node
"use strict";
/**
 * Record task metrics for MTTA/MTTR analysis
 *
 * This script records timing and outcome metrics at the end of each task,
 * enabling analysis of worker performance and process improvements.
 *
 * Inputs (environment variables):
 * - TASK_ID: Required. Unique task identifier
 * - TICKET_KEY: Required. The ticket being worked on
 * - SEVERITY: Optional. P1-P5 severity classification
 * - OUTCOME: Required. "completed", "blocked", "escalated", "no_changes"
 * - STARTED_AT: Optional. ISO timestamp when task started
 * - FIRST_ACTION_AT: Optional. ISO timestamp of first meaningful action
 * - COMPLETED_AT: Optional. ISO timestamp when task completed (defaults to now)
 * - PHASE_ANALYSIS: Optional. Seconds spent in analysis phase
 * - PHASE_IMPLEMENTATION: Optional. Seconds spent implementing
 * - PHASE_TESTING: Optional. Seconds spent testing
 * - PHASE_PR: Optional. Seconds spent on PR creation
 * - WORKER_PERSONA: Optional. The persona that executed the task
 * - METRICS_ENDPOINT: Optional. URL to POST metrics to
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - metricsRecorded: object
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function makeRequest(url, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === "https:" ? https : http;
        const req = protocol.request(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ statusCode: res.statusCode || 0, body: data }));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}
function calculateDuration(start, end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    return Math.round((endDate.getTime() - startDate.getTime()) / 1000);
}
async function main() {
    const output = { success: false };
    try {
        const taskId = process.env.TASK_ID;
        const ticketKey = process.env.TICKET_KEY;
        // Default to "completed" if OUTCOME not specified
        const outcome = process.env.OUTCOME || "completed";
        if (!taskId)
            throw new Error("TASK_ID is required");
        if (!ticketKey)
            throw new Error("TICKET_KEY is required");
        const validOutcomes = ["completed", "blocked", "escalated", "no_changes", "deployed"];
        if (!validOutcomes.includes(outcome)) {
            throw new Error(`OUTCOME must be one of: ${validOutcomes.join(", ")}`);
        }
        const now = new Date().toISOString();
        const startedAt = process.env.STARTED_AT;
        const firstActionAt = process.env.FIRST_ACTION_AT;
        const completedAt = process.env.COMPLETED_AT || now;
        // Build metrics object
        const metrics = {
            taskId,
            ticketKey,
            severity: process.env.SEVERITY,
            outcome,
            workerPersona: process.env.WORKER_PERSONA,
            timing: {
                startedAt,
                firstActionAt,
                completedAt,
            },
        };
        // Calculate durations
        if (startedAt) {
            metrics.timing.totalDurationSeconds = calculateDuration(startedAt, completedAt);
            metrics.computed = metrics.computed || {};
            metrics.computed.mttr = metrics.timing.totalDurationSeconds;
        }
        if (startedAt && firstActionAt) {
            metrics.timing.timeToFirstActionSeconds = calculateDuration(startedAt, firstActionAt);
            metrics.computed = metrics.computed || {};
            metrics.computed.mtta = metrics.timing.timeToFirstActionSeconds;
        }
        // Add phase timings if provided
        const phases = {};
        if (process.env.PHASE_ANALYSIS)
            phases.analysis = parseInt(process.env.PHASE_ANALYSIS);
        if (process.env.PHASE_IMPLEMENTATION)
            phases.implementation = parseInt(process.env.PHASE_IMPLEMENTATION);
        if (process.env.PHASE_TESTING)
            phases.testing = parseInt(process.env.PHASE_TESTING);
        if (process.env.PHASE_PR)
            phases.prCreation = parseInt(process.env.PHASE_PR);
        if (Object.keys(phases).length > 0) {
            metrics.phases = phases;
        }
        output.metricsRecorded = metrics;
        // Save locally to metrics file
        const metricsDir = process.env.METRICS_DIR || "/tmp/workermill-metrics";
        if (!fs.existsSync(metricsDir)) {
            fs.mkdirSync(metricsDir, { recursive: true });
        }
        const metricsFile = path.join(metricsDir, `${taskId}.json`);
        fs.writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
        output.savedTo = metricsFile;
        // Also append to aggregate file
        const aggregateFile = path.join(metricsDir, "all-metrics.jsonl");
        fs.appendFileSync(aggregateFile, JSON.stringify(metrics) + "\n");
        // Send to metrics endpoint if configured
        const metricsEndpoint = process.env.METRICS_ENDPOINT;
        if (metricsEndpoint) {
            try {
                const response = await makeRequest(metricsEndpoint, JSON.stringify(metrics));
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    output.sentTo = metricsEndpoint;
                }
                else {
                    console.error(`[metrics] Failed to send to endpoint: ${response.statusCode}`);
                }
            }
            catch (err) {
                console.error(`[metrics] Error sending to endpoint:`, err);
            }
        }
        output.success = true;
    }
    catch (error) {
        output.error = error instanceof Error ? error.message : String(error);
    }
    console.log(JSON.stringify(output));
    // Output markers for orchestrator
    if (output.metricsRecorded) {
        const m = output.metricsRecorded;
        console.error(`::metric::outcome=${m.outcome}`);
        if (m.computed?.mtta) {
            console.error(`::metric::mtta=${m.computed.mtta}s`);
        }
        if (m.computed?.mttr) {
            console.error(`::metric::mttr=${m.computed.mttr}s`);
        }
        if (m.severity) {
            console.error(`::metric::severity=${m.severity}`);
        }
    }
    process.exit(output.success ? 0 : 1);
}
main();
