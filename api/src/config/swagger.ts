import swaggerJsdoc from "swagger-jsdoc";

/**
 * OpenAPI 3.0 Specification for WorkerMill API
 *
 * This configuration defines the base structure for auto-generated API documentation.
 * Route-specific documentation is added via JSDoc comments in route files.
 */

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "WorkerMill API",
    version: "1.0.0",
    description:
      "API for AI worker orchestration and monitoring. WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks.",
    contact: {
      name: "WorkerMill Support",
      url: "https://workermill.com",
    },
    license: {
      name: "Proprietary",
    },
  },
  servers: [
    {
      url: "https://workermill.com",
      description: "Production server",
    },
    {
      url: "http://localhost:4000",
      description: "Development server",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT token from AWS Cognito authentication",
      },
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "Organization API key for worker authentication",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "string",
            description: "Error message",
          },
        },
        required: ["error"],
      },
      Task: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
            description: "Unique task identifier",
          },
          orgId: {
            type: "string",
            format: "uuid",
            description: "Organization ID",
          },
          jiraIssueKey: {
            type: "string",
            description: "Jira issue key (e.g., PROJ-123)",
          },
          jiraIssueId: {
            type: "string",
            description: "Jira issue ID",
          },
          summary: {
            type: "string",
            description: "Task summary/title",
          },
          description: {
            type: "string",
            nullable: true,
            description: "Task description",
          },
          status: {
            type: "string",
            enum: [
              "queued",
              "claimed",
              "environment_setup",
              "executing",
              "pr_created",
              "review_requested",
              "manager_review",
              "pr_approved",
              "review_approved",
              "deploying",
              "deployed",
              "completed",
              "failed",
              "cancelled",
              "escalated",
              "review_rejected",
            ],
            description: "Current task status",
          },
          workerPersona: {
            type: "string",
            description: "Worker persona/role (e.g., backend_developer, frontend_developer)",
          },
          workerModel: {
            type: "string",
            description: "AI model used (e.g., claude-haiku-4-5-20251001)",
          },
          workerProvider: {
            type: "string",
            description: "AI provider (e.g., anthropic)",
          },
          githubRepo: {
            type: "string",
            description: "Target GitHub repository",
          },
          githubPrUrl: {
            type: "string",
            nullable: true,
            description: "URL of created pull request",
          },
          githubPrNumber: {
            type: "integer",
            nullable: true,
            description: "Pull request number",
          },
          githubBranch: {
            type: "string",
            nullable: true,
            description: "Git branch name",
          },
          estimatedCostUsd: {
            type: "number",
            format: "decimal",
            description: "Estimated cost in USD",
          },
          inputTokens: {
            type: "integer",
            description: "Number of input tokens used",
          },
          outputTokens: {
            type: "integer",
            description: "Number of output tokens generated",
          },
          retryCount: {
            type: "integer",
            description: "Number of retry attempts",
          },
          maxRetries: {
            type: "integer",
            description: "Maximum allowed retries",
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Task creation timestamp",
          },
          startedAt: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "Task start timestamp",
          },
          completedAt: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "Task completion timestamp",
          },
        },
      },
      BillingStatus: {
        type: "object",
        properties: {
          plan: {
            type: "string",
            enum: ["free", "pro", "enterprise"],
            description: "Current subscription plan",
          },
          usage: {
            type: "object",
            properties: {
              tasks: {
                type: "integer",
                description: "Number of tasks used this billing period",
              },
              quota: {
                type: "integer",
                description: "Usage limit for current plan (-1 for unlimited). See billing page for compute hours.",
              },
              percent: {
                type: "integer",
                description: "Usage percentage (0-100)",
              },
              isUnlimited: {
                type: "boolean",
                description: "Whether plan has unlimited compute hours",
              },
            },
          },
          billing: {
            type: "object",
            properties: {
              customerId: {
                type: "string",
                nullable: true,
                description: "Stripe customer ID",
              },
              subscriptionId: {
                type: "string",
                nullable: true,
                description: "Stripe subscription ID",
              },
              subscriptionStatus: {
                type: "string",
                nullable: true,
                description: "Subscription status",
              },
              billingCycleStart: {
                type: "string",
                format: "date-time",
                nullable: true,
                description: "Start of current billing cycle",
              },
              hasPaymentMethod: {
                type: "boolean",
                description: "Whether payment method is on file",
              },
            },
          },
          quotaStatus: {
            type: "object",
            properties: {
              allowed: {
                type: "boolean",
                description: "Whether new tasks can be created",
              },
              reason: {
                type: "string",
                nullable: true,
                description: "Reason if tasks are not allowed",
              },
            },
          },
          stripeConfigured: {
            type: "boolean",
            description: "Whether Stripe is configured on the server",
          },
        },
      },
      Plan: {
        type: "object",
        properties: {
          id: {
            type: "string",
            enum: ["free", "pro", "enterprise"],
            description: "Plan identifier",
          },
          name: {
            type: "string",
            description: "Plan display name",
          },
          price: {
            type: "number",
            nullable: true,
            description: "Monthly price in USD (null for custom pricing)",
          },
          taskQuota: {
            type: "integer",
            description: "Legacy field. Plans use task-based quotas.",
          },
          userLimit: {
            type: "integer",
            description: "Maximum users (-1 for unlimited)",
          },
          features: {
            type: "array",
            items: {
              type: "string",
            },
            description: "List of plan features",
          },
        },
      },
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
  tags: [
    {
      name: "Health",
      description: "Health check endpoints",
    },
    {
      name: "Billing",
      description: "Subscription and billing management",
    },
    {
      name: "Tasks",
      description: "Worker task management and execution",
    },
    {
      name: "Control Center",
      description: "Dashboard data and real-time monitoring",
    },
    {
      name: "Logs",
      description: "Task log streaming and retrieval",
    },
  ],
};

const options: swaggerJsdoc.Options = {
  definition: swaggerDefinition,
  // Path to the API route files with JSDoc comments
  apis: [
    "./src/routes/*.ts",
    "./src/routes/*.js",
    "./dist/routes/*.js", // Include compiled files for production
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
