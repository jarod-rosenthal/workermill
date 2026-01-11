import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // Database
  database: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    name: process.env.DB_NAME || "workermill",
    username: process.env.DB_USERNAME || "workermill",
    password: process.env.DB_PASSWORD || "",
    url: process.env.DATABASE_URL,
  },

  // AWS
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    ecsCluster: process.env.ECS_CLUSTER || "workermill-dev",
    workerTaskDefinition: process.env.WORKER_TASK_DEFINITION || "workermill-dev-worker",
    privateSubnets: (process.env.PRIVATE_SUBNETS || "").split(",").filter(Boolean),
    securityGroups: (process.env.SECURITY_GROUPS || "").split(",").filter(Boolean),
    workerLogGroup: process.env.WORKER_LOG_GROUP || "/ecs/workermill-dev/worker",
    sqsJobsQueueUrl: process.env.SQS_JOBS_QUEUE_URL || "",
  },

  // Cognito
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID || "COGNITO_POOL_ID",
    clientId: process.env.COGNITO_CLIENT_ID || "COGNITO_CLIENT_ID",
    region: process.env.AWS_REGION || "us-east-1",
  },

  // Secrets
  secrets: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    githubToken: process.env.GITHUB_TOKEN || "",
    jiraCredentials: process.env.JIRA_CREDENTIALS || "",
  },

  // API
  apiBaseUrl: process.env.API_BASE_URL || "https://workermill.com",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,https://workermill.com").split(","),
};
