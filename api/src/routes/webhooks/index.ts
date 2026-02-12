import { Router } from "express";
import jiraRouter from "./jira.js";
import githubRouter from "./github.js";
import linearRouter from "./linear.js";
import githubIssuesRouter from "./github-issues.js";
import gitlabRouter from "./gitlab.js";
import bitbucketRouter from "./bitbucket.js";
import emailRouter from "./email.js";
import supportRouter from "./support.js";
import githubRunnerRouter from "./github-runner.js";

// Re-export shared helpers for external consumers
export { cleanupOldWebhookDeliveries } from "./helpers.js";

const router = Router();

// Mount all webhook sub-routers
router.use(jiraRouter);
router.use(githubRouter);
router.use(linearRouter);
router.use(githubIssuesRouter);
router.use(gitlabRouter);
router.use(bitbucketRouter);
router.use(emailRouter);
router.use(supportRouter);
router.use(githubRunnerRouter);

export default router;
