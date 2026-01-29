import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { WorkerTaskLog } from "../models/WorkerTaskLog.js";
import {
  ProceduralMemory,
  SkillStep,
  SkillApplicability,
} from "../models/ProceduralMemory.js";
import { EpisodicMemory } from "../models/EpisodicMemory.js";
import { logger } from "../utils/logger.js";

/**
 * Extracted skill candidate from a task
 */
export interface SkillCandidate {
  name: string;
  description: string;
  steps: SkillStep[];
  applicability: SkillApplicability;
  confidence: number;
  sourceTaskId: string;
  sourceTaskTitle: string;
  technologies: string[];
}

/**
 * Extraction result
 */
export interface ExtractionResult {
  taskId: string;
  taskTitle: string;
  skillsExtracted: number;
  skillsCandidates: SkillCandidate[];
  skillsCreated: ProceduralMemory[];
  skillsUpdated: ProceduralMemory[];
}

/**
 * Pattern to look for in task logs
 */
interface LogPattern {
  keyword: string;
  category: string;
  weight: number;
}

// Patterns that indicate skill-worthy actions
const SKILL_PATTERNS: LogPattern[] = [
  // Development patterns
  { keyword: "refactor", category: "development", weight: 1.0 },
  { keyword: "implement", category: "development", weight: 0.9 },
  { keyword: "create", category: "development", weight: 0.8 },
  { keyword: "add", category: "development", weight: 0.7 },
  { keyword: "update", category: "development", weight: 0.6 },

  // Testing patterns
  { keyword: "test", category: "testing", weight: 1.0 },
  { keyword: "assert", category: "testing", weight: 0.9 },
  { keyword: "mock", category: "testing", weight: 0.8 },
  { keyword: "fixture", category: "testing", weight: 0.7 },

  // Error handling
  { keyword: "error handling", category: "error-handling", weight: 1.0 },
  { keyword: "try-catch", category: "error-handling", weight: 0.9 },
  { keyword: "validation", category: "validation", weight: 0.8 },

  // API patterns
  { keyword: "api", category: "api", weight: 1.0 },
  { keyword: "endpoint", category: "api", weight: 0.9 },
  { keyword: "route", category: "api", weight: 0.8 },
  { keyword: "middleware", category: "api", weight: 0.7 },

  // Database patterns
  { keyword: "migration", category: "database", weight: 1.0 },
  { keyword: "query", category: "database", weight: 0.8 },
  { keyword: "model", category: "database", weight: 0.7 },

  // Infrastructure
  { keyword: "deploy", category: "infrastructure", weight: 1.0 },
  { keyword: "docker", category: "infrastructure", weight: 0.9 },
  { keyword: "terraform", category: "infrastructure", weight: 0.9 },
  { keyword: "kubernetes", category: "infrastructure", weight: 0.9 },

  // Security
  { keyword: "auth", category: "security", weight: 1.0 },
  { keyword: "security", category: "security", weight: 1.0 },
  { keyword: "permission", category: "security", weight: 0.8 },
];

/**
 * Skill Extractor Service - REQ-14
 *
 * Automatically extracts reusable skills from successful task completions.
 * Analyzes task logs and outcomes to identify patterns that worked.
 */
export class SkillExtractor {
  private taskRepo = AppDataSource.getRepository(WorkerTask);
  private logRepo = AppDataSource.getRepository(WorkerTaskLog);
  private proceduralRepo = AppDataSource.getRepository(ProceduralMemory);
  private episodicRepo = AppDataSource.getRepository(EpisodicMemory);

  /**
   * Extract skills from a completed task
   */
  async extractFromTask(
    orgId: string,
    taskId: string,
    options: { autoCreate?: boolean; minConfidence?: number } = {}
  ): Promise<ExtractionResult> {
    const { autoCreate = false, minConfidence = 0.6 } = options;

    logger.info("Extracting skills from task", { orgId, taskId });

    // Get the task
    const task = await this.taskRepo.findOne({
      where: { id: taskId, orgId },
    });

    if (!task) {
      throw new Error("Task not found");
    }

    if (task.status !== "completed") {
      throw new Error("Can only extract skills from completed tasks");
    }

    // Get task logs
    const logs = await this.logRepo.find({
      where: { taskId },
      order: { createdAt: "ASC" },
    });

    // Extract skill candidates
    const candidates = this.analyzeLogsForSkills(task, logs);

    // Filter by confidence
    const qualifiedCandidates = candidates.filter((c) => c.confidence >= minConfidence);

    const result: ExtractionResult = {
      taskId,
      taskTitle: task.summary || task.jiraIssueKey || "Untitled",
      skillsExtracted: qualifiedCandidates.length,
      skillsCandidates: qualifiedCandidates,
      skillsCreated: [],
      skillsUpdated: [],
    };

    // Optionally create the skills
    if (autoCreate) {
      for (const candidate of qualifiedCandidates) {
        const created = await this.createOrUpdateSkill(orgId, candidate);
        if (created.isNew) {
          result.skillsCreated.push(created.skill);
        } else {
          result.skillsUpdated.push(created.skill);
        }
      }
    }

    // Also create episodic memory for this extraction
    if (qualifiedCandidates.length > 0) {
      await this.createEpisodicMemory(orgId, task, qualifiedCandidates);
    }

    logger.info("Skill extraction complete", {
      orgId,
      taskId,
      candidatesFound: candidates.length,
      qualified: qualifiedCandidates.length,
      created: result.skillsCreated.length,
      updated: result.skillsUpdated.length,
    });

    return result;
  }

  /**
   * Batch extract skills from recent successful tasks
   */
  async batchExtract(
    orgId: string,
    options: { days?: number; maxTasks?: number; autoCreate?: boolean } = {}
  ): Promise<{
    tasksProcessed: number;
    skillsFound: number;
    skillsCreated: number;
    skillsUpdated: number;
  }> {
    const { days = 30, maxTasks = 50, autoCreate = true } = options;

    logger.info("Batch extracting skills", { orgId, days, maxTasks });

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get successful tasks
    const tasks = await this.taskRepo
      .createQueryBuilder("t")
      .where("t.org_id = :orgId", { orgId })
      .andWhere("t.status = :status", { status: "completed" })
      .andWhere("t.completed_at >= :since", { since })
      .orderBy("t.completed_at", "DESC")
      .limit(maxTasks)
      .getMany();

    let skillsFound = 0;
    let skillsCreated = 0;
    let skillsUpdated = 0;

    for (const task of tasks) {
      try {
        const result = await this.extractFromTask(orgId, task.id, { autoCreate });
        skillsFound += result.skillsExtracted;
        skillsCreated += result.skillsCreated.length;
        skillsUpdated += result.skillsUpdated.length;
      } catch (error) {
        logger.warn("Error extracting skills from task", { error, taskId: task.id });
      }
    }

    return {
      tasksProcessed: tasks.length,
      skillsFound,
      skillsCreated,
      skillsUpdated,
    };
  }

  /**
   * Get skill suggestions for a task based on its description
   */
  async suggestSkillsForTask(
    orgId: string,
    taskDescription: string,
    options: { limit?: number } = {}
  ): Promise<ProceduralMemory[]> {
    const { limit = 5 } = options;

    // Extract keywords from description
    const keywords = this.extractKeywords(taskDescription);

    if (keywords.length === 0) {
      return [];
    }

    // Find skills that match the keywords
    const skills = await this.proceduralRepo
      .createQueryBuilder("s")
      .where("s.orgId = :orgId", { orgId })
      .andWhere("s.successRate IS NULL OR s.successRate >= :minRate", { minRate: 0.5 })
      .orderBy("s.successRate", "DESC", "NULLS LAST")
      .addOrderBy("s.successCount", "DESC")
      .getMany();

    // Score skills based on keyword matches
    const scoredSkills = skills.map((skill) => {
      const skillText = `${skill.name} ${skill.description} ${skill.steps.map((s) => s.action).join(" ")}`.toLowerCase();
      let score = 0;

      for (const keyword of keywords) {
        if (skillText.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      // Boost by success rate
      if (skill.successRate) {
        score *= 1 + skill.successRate;
      }

      return { skill, score };
    });

    // Return top matching skills
    return scoredSkills
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.skill);
  }

  // Private helper methods

  private analyzeLogsForSkills(task: WorkerTask, logs: WorkerTaskLog[]): SkillCandidate[] {
    const candidates: SkillCandidate[] = [];

    // Combine log content for analysis
    const logContent = logs.map((l) => l.message).join("\n");
    const lowerContent = logContent.toLowerCase();

    // Detect patterns and extract steps
    const detectedPatterns: Map<string, { count: number; weight: number; excerpts: string[] }> = new Map();

    for (const pattern of SKILL_PATTERNS) {
      if (lowerContent.includes(pattern.keyword.toLowerCase())) {
        const existing = detectedPatterns.get(pattern.category);
        if (existing) {
          existing.count++;
          existing.weight = Math.max(existing.weight, pattern.weight);
        } else {
          detectedPatterns.set(pattern.category, {
            count: 1,
            weight: pattern.weight,
            excerpts: this.extractExcerpts(logContent, pattern.keyword),
          });
        }
      }
    }

    // Create skill candidates from detected patterns
    for (const [category, data] of detectedPatterns) {
      if (data.count >= 2 || data.weight >= 0.9) {
        // Enough evidence for a skill
        const steps = this.generateStepsFromExcerpts(data.excerpts, category);

        if (steps.length >= 2) {
          const confidence = Math.min(0.9, data.weight * (1 + data.count * 0.1));

          candidates.push({
            name: this.generateSkillName(category, task),
            description: this.generateSkillDescription(category, task, steps),
            steps,
            applicability: {
              taskTypes: [this.inferTaskType(task)],
              technologies: this.extractTechnologies(logContent),
              keywords: [category],
            },
            confidence,
            sourceTaskId: task.id,
            sourceTaskTitle: task.summary || task.jiraIssueKey || "Untitled",
            technologies: this.extractTechnologies(logContent),
          });
        }
      }
    }

    return candidates;
  }

  private extractExcerpts(content: string, keyword: string): string[] {
    const excerpts: string[] = [];
    const lines = content.split("\n");
    const lowerKeyword = keyword.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerKeyword)) {
        // Get context (line before, matching line, line after)
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 1);
        excerpts.push(lines.slice(start, end + 1).join("\n").trim());
      }
    }

    return excerpts.slice(0, 5); // Limit excerpts
  }

  private generateStepsFromExcerpts(excerpts: string[], category: string): SkillStep[] {
    const steps: SkillStep[] = [];

    // Generate steps based on category and excerpts
    switch (category) {
      case "development":
        steps.push(
          { step: 1, action: "Analyze requirements and existing code", details: "Review the task requirements and related codebase" },
          { step: 2, action: "Plan the implementation approach", details: "Identify files to modify and patterns to follow" },
          { step: 3, action: "Implement the changes incrementally", details: "Make changes in logical commits" },
          { step: 4, action: "Add tests for new functionality", details: "Ensure code coverage for changes" },
          { step: 5, action: "Review and refactor if needed", details: "Clean up code and improve readability" }
        );
        break;
      case "testing":
        steps.push(
          { step: 1, action: "Identify test scenarios", details: "List happy path, edge cases, and error conditions" },
          { step: 2, action: "Set up test fixtures and mocks", details: "Prepare test data and mock dependencies" },
          { step: 3, action: "Write test cases", details: "Implement tests following AAA pattern (Arrange, Act, Assert)" },
          { step: 4, action: "Run tests and verify coverage", details: "Ensure all scenarios are covered" }
        );
        break;
      case "api":
        steps.push(
          { step: 1, action: "Define API contract", details: "Specify request/response formats and status codes" },
          { step: 2, action: "Implement route handler", details: "Create Express route with validation" },
          { step: 3, action: "Add middleware if needed", details: "Authentication, authorization, rate limiting" },
          { step: 4, action: "Write API tests", details: "Integration tests for the endpoint" },
          { step: 5, action: "Document the endpoint", details: "Update API documentation" }
        );
        break;
      case "database":
        steps.push(
          { step: 1, action: "Design schema changes", details: "Plan table/column modifications" },
          { step: 2, action: "Create migration", details: "Write idempotent up/down migrations" },
          { step: 3, action: "Update models", details: "Modify TypeORM entities" },
          { step: 4, action: "Test migration", details: "Verify migration runs correctly" }
        );
        break;
      case "error-handling":
        steps.push(
          { step: 1, action: "Identify failure points", details: "Map where errors can occur" },
          { step: 2, action: "Add try-catch blocks", details: "Wrap risky operations" },
          { step: 3, action: "Create error classes if needed", details: "Custom error types for specific cases" },
          { step: 4, action: "Log errors appropriately", details: "Include context for debugging" },
          { step: 5, action: "Return appropriate responses", details: "User-friendly messages, proper status codes" }
        );
        break;
      default: {
        // Generic steps based on excerpts
        const excerptSteps = excerpts.slice(0, 4).map((e, i) => ({
          step: i + 1,
          action: this.summarizeExcerpt(e),
          details: e.substring(0, 100),
        }));
        if (excerptSteps.length >= 2) {
          steps.push(...excerptSteps);
        }
      }
    }

    return steps;
  }

  private summarizeExcerpt(excerpt: string): string {
    // Simple summarization - take first line or first 50 chars
    const firstLine = excerpt.split("\n")[0].trim();
    if (firstLine.length <= 50) return firstLine;
    return firstLine.substring(0, 47) + "...";
  }

  private generateSkillName(category: string, task: WorkerTask): string {
    const taskType = this.inferTaskType(task);
    const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, " ");
    return `${categoryTitle} for ${taskType}`;
  }

  private generateSkillDescription(category: string, task: WorkerTask, steps: SkillStep[]): string {
    const taskType = this.inferTaskType(task);
    return `Procedure for ${category.replace(/-/g, " ")} in ${taskType} tasks. Extracted from successful task: "${task.summary || task.jiraIssueKey}". Contains ${steps.length} steps.`;
  }

  private inferTaskType(task: WorkerTask): string {
    const summary = (task.summary || "").toLowerCase();
    const description = (task.description || "").toLowerCase();
    const combined = `${summary} ${description}`;

    if (combined.includes("fix") || combined.includes("bug")) return "bugfix";
    if (combined.includes("feature") || combined.includes("add") || combined.includes("implement")) return "feature";
    if (combined.includes("refactor") || combined.includes("improve")) return "refactor";
    if (combined.includes("test")) return "testing";
    if (combined.includes("doc")) return "documentation";
    if (combined.includes("security") || combined.includes("auth")) return "security";
    if (combined.includes("deploy") || combined.includes("infra")) return "infrastructure";

    return "general";
  }

  private extractTechnologies(content: string): string[] {
    const technologies: string[] = [];
    const lowerContent = content.toLowerCase();

    const techKeywords = [
      "typescript", "javascript", "node", "express", "react", "vue", "angular",
      "python", "django", "fastapi", "go", "rust", "java", "spring",
      "postgres", "mysql", "mongodb", "redis", "elasticsearch",
      "docker", "kubernetes", "terraform", "aws", "azure", "gcp",
      "graphql", "rest", "grpc",
    ];

    for (const tech of techKeywords) {
      if (lowerContent.includes(tech)) {
        technologies.push(tech);
      }
    }

    return [...new Set(technologies)];
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction
    const words = text.toLowerCase().split(/\s+/);
    const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare", "to", "of", "in", "for", "on", "with", "at", "by", "from", "up", "about", "into", "through", "during", "before", "after", "above", "below", "between", "under", "again", "further", "then", "once"]);

    return words
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .slice(0, 20);
  }

  private async createOrUpdateSkill(
    orgId: string,
    candidate: SkillCandidate
  ): Promise<{ skill: ProceduralMemory; isNew: boolean }> {
    // Check for existing similar skill
    const slug = this.generateSlug(candidate.name);
    const existing = await this.proceduralRepo.findOne({
      where: { orgId, slug },
    });

    if (existing) {
      // Update existing skill
      existing.successCount += 1;
      existing.retrievalCount += 1;
      // Merge steps if different
      if (candidate.steps.length > existing.steps.length) {
        existing.steps = candidate.steps;
      }
      const updated = await this.proceduralRepo.save(existing);
      return { skill: updated, isNew: false };
    }

    // Create new skill
    const skill = this.proceduralRepo.create({
      orgId,
      name: candidate.name,
      slug,
      description: candidate.description,
      steps: candidate.steps,
      applicableTo: candidate.applicability,
      successCount: 1,
      failureCount: 0,
    });

    const saved = await this.proceduralRepo.save(skill);
    return { skill: saved, isNew: true };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private async createEpisodicMemory(
    orgId: string,
    task: WorkerTask,
    candidates: SkillCandidate[]
  ): Promise<void> {
    const memory = this.episodicRepo.create({
      orgId,
      taskId: task.id,
      repository: task.githubRepo,
      eventType: "pattern_discovered" as const,
      summary: `Extracted ${candidates.length} skill(s) from task: ${task.summary || task.jiraIssueKey}`,
      details: {
        skillNames: candidates.map((c) => c.name),
        technologies: [...new Set(candidates.flatMap((c) => c.technologies))],
        categories: [...new Set(candidates.map((c) => c.applicability.keywords?.[0]).filter(Boolean))],
      },
      outcome: "success" as const,
      outcomeDetails: `Successfully extracted reusable procedures from completed task`,
      persona: task.workerPersona,
      model: task.workerModel,
    });

    await this.episodicRepo.save(memory);
  }
}

// Export singleton instance
export const skillExtractor = new SkillExtractor();
