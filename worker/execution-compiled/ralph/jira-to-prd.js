***REMOVED***!/usr/bin/env ts-node
"use strict";
/**
 * Jira-to-PRD Converter
 *
 * Converts Jira ticket content into Ralph's Product Requirements Document (PRD) format.
 *
 * Input: Jira ticket JSON (via environment variables or stdin)
 * Output: .ralph/prd.md in the target repository
 *
 * Mapping:
 * - Jira Summary → PRD Title
 * - Jira Description → PRD Overview
 * - Jira Acceptance Criteria → PRD Requirements (parses Gherkin GIVEN/WHEN/THEN)
 * - Jira Technical Notes → PRD Constraints
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
/**
 * Parse Gherkin-format acceptance criteria into structured scenarios
 */
function parseGherkinCriteria(criteria) {
    const scenarios = [];
    const lines = criteria.split("\n").map((l) => l.trim());
    let currentScenario = null;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        // Skip empty lines and comments
        if (!line || line.startsWith("***REMOVED***")) {
            i++;
            continue;
        }
        // Scenario header
        if (line.toLowerCase().startsWith("scenario:") ||
            line.toLowerCase().startsWith("scenario outline:")) {
            // Save previous scenario if exists
            if (currentScenario &&
                currentScenario.title &&
                currentScenario.when &&
                currentScenario.then) {
                scenarios.push({
                    title: currentScenario.title,
                    given: currentScenario.given || [],
                    when: currentScenario.when,
                    then: currentScenario.then || [],
                });
            }
            // Start new scenario
            currentScenario = {
                title: line.replace(/^scenario\s*(\w+):\s*/i, "").trim(),
                given: [],
                when: "",
                then: [],
            };
            i++;
            continue;
        }
        // GIVEN lines
        if (line.toLowerCase().startsWith("given")) {
            const givenText = line.replace(/^given\s+/i, "").trim();
            if (currentScenario) {
                if (!currentScenario.given)
                    currentScenario.given = [];
                currentScenario.given.push(givenText);
            }
            i++;
            continue;
        }
        // AND (continuation of GIVEN/WHEN/THEN)
        if (line.toLowerCase().startsWith("and")) {
            const andText = line.replace(/^and\s+/i, "").trim();
            if (currentScenario) {
                if (currentScenario.then && currentScenario.then.length > 0) {
                    // AND after THEN goes to THEN
                    currentScenario.then.push(andText);
                }
                else if (currentScenario.when) {
                    // AND after WHEN could be continuation, treat as THEN
                    if (!currentScenario.then)
                        currentScenario.then = [];
                    currentScenario.then.push(andText);
                }
                else if (currentScenario.given) {
                    // AND after GIVEN continues GIVEN
                    currentScenario.given.push(andText);
                }
            }
            i++;
            continue;
        }
        // WHEN lines
        if (line.toLowerCase().startsWith("when")) {
            const whenText = line.replace(/^when\s+/i, "").trim();
            if (currentScenario) {
                currentScenario.when = whenText;
            }
            i++;
            continue;
        }
        // THEN lines
        if (line.toLowerCase().startsWith("then")) {
            const thenText = line.replace(/^then\s+/i, "").trim();
            if (currentScenario) {
                if (!currentScenario.then)
                    currentScenario.then = [];
                currentScenario.then.push(thenText);
            }
            i++;
            continue;
        }
        i++;
    }
    // Don't forget the last scenario
    if (currentScenario &&
        currentScenario.title &&
        currentScenario.when &&
        currentScenario.then) {
        scenarios.push({
            title: currentScenario.title,
            given: currentScenario.given || [],
            when: currentScenario.when,
            then: currentScenario.then || [],
        });
    }
    return scenarios;
}
/**
 * Extract constraints from technical notes
 */
function parseConstraints(technicalNotes) {
    if (!technicalNotes)
        return [];
    // Split by common delimiters: newlines, bullets, dashes
    return technicalNotes
        .split(/[\n-•*]+/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0 && c.length < 500); // Reasonable constraint length
}
/**
 * Load Jira ticket from environment variables
 */
function loadJiraTicket() {
    const jsonInput = process.env.JIRA_TICKET_JSON;
    if (!jsonInput) {
        console.error("ERROR: JIRA_TICKET_JSON environment variable not set or empty");
        process.exit(1);
    }
    try {
        const ticket = JSON.parse(jsonInput);
        // Validate required fields
        if (!ticket.key || !ticket.summary) {
            throw new Error("Missing required fields: key and summary");
        }
        return ticket;
    }
    catch (error) {
        console.error("ERROR: Failed to parse JIRA_TICKET_JSON:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
/**
 * Generate PRD markdown content
 */
function generatePRDMarkdown(prd) {
    let markdown = `***REMOVED*** ${prd.title}\n\n`;
    // Overview section
    if (prd.overview) {
        markdown += `***REMOVED******REMOVED*** Overview\n\n${prd.overview}\n\n`;
    }
    // Requirements section
    if (prd.requirements.length > 0) {
        markdown += `***REMOVED******REMOVED*** Requirements\n\n`;
        prd.requirements.forEach((scenario, idx) => {
            markdown += `***REMOVED******REMOVED******REMOVED*** Scenario ${idx + 1}: ${scenario.title}\n\n`;
            if (scenario.given.length > 0) {
                markdown += `**Given:**\n`;
                scenario.given.forEach((g) => {
                    markdown += `- ${g}\n`;
                });
                markdown += "\n";
            }
            if (scenario.when) {
                markdown += `**When:**\n`;
                markdown += `- ${scenario.when}\n\n`;
            }
            if (scenario.then.length > 0) {
                markdown += `**Then:**\n`;
                scenario.then.forEach((t) => {
                    markdown += `- ${t}\n`;
                });
                markdown += "\n";
            }
        });
    }
    // Constraints section
    if (prd.constraints.length > 0) {
        markdown += `***REMOVED******REMOVED*** Constraints\n\n`;
        prd.constraints.forEach((constraint) => {
            markdown += `- ${constraint}\n`;
        });
        markdown += "\n";
    }
    markdown += `***REMOVED******REMOVED*** Metadata\n\n`;
    markdown += `- **Source Ticket:** ${process.env.TICKET_KEY || "unknown"}\n`;
    markdown += `- **Generated:** ${new Date().toISOString()}\n`;
    markdown += `- **Converter:** WorkerMill Jira-to-PRD (Phase 2)\n`;
    return markdown;
}
/**
 * Main execution
 */
async function main() {
    try {
        // Load Jira ticket from environment
        const ticket = loadJiraTicket();
        // Parse acceptance criteria into Gherkin scenarios
        const requirements = parseGherkinCriteria(ticket.acceptanceCriteria || "");
        // Parse constraints from technical notes
        const constraints = parseConstraints(ticket.technicalNotes || "");
        // Build PRD object
        const prd = {
            title: ticket.summary,
            overview: ticket.description || "(No description provided)",
            requirements: requirements.length > 0
                ? requirements
                : [
                    {
                        title: "Default Requirement",
                        given: [],
                        when: "the task is executed",
                        then: ["the requirements from the ticket are satisfied"],
                    },
                ],
            constraints: constraints.length > 0
                ? constraints
                : ["Follow existing code patterns and conventions"],
        };
        // Generate markdown
        const markdown = generatePRDMarkdown(prd);
        // Ensure .ralph directory exists
        const ralphDir = path.join(process.env.REPO_PATH || "/workspace/repo", ".ralph");
        if (!fs.existsSync(ralphDir)) {
            fs.mkdirSync(ralphDir, { recursive: true });
        }
        // Write PRD to file
        const prdPath = path.join(ralphDir, "prd.md");
        fs.writeFileSync(prdPath, markdown, "utf8");
        console.log(`[ralph-converter] PRD written to ${prdPath}`);
        console.log(`[ralph-converter] Parsed ${requirements.length} scenarios and ${constraints.length} constraints`);
        // Also output the ticket metadata for Ralph planning
        const metadataPath = path.join(ralphDir, "ticket.json");
        const metadata = {
            key: ticket.key,
            summary: ticket.summary,
            description: ticket.description,
            acceptanceCriteria: ticket.acceptanceCriteria,
            technicalNotes: ticket.technicalNotes,
            scenarioCount: requirements.length,
            constraintCount: constraints.length,
            generatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
        console.log(`[ralph-converter] Ticket metadata written to ${metadataPath}`);
        console.log("[ralph-converter] Ready for ralph plan");
        process.exit(0);
    }
    catch (error) {
        console.error("[ralph-converter] FATAL:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
main();
