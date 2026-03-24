import { Router } from "express";
import cognitoRouter from "./cognito.js";
import registrationRouter from "./registration.js";
import passwordRouter from "./password.js";
import accountRouter from "./account.js";
import ssoRouter from "./sso.js";
import oauthMicrosoftRouter from "./oauth-microsoft.js";
import oauthGithubRouter from "./oauth-github.js";

const router = Router();

// NOTE: No global auth middleware — auth endpoints are mostly public.
// Each sub-router applies its own auth middleware per-endpoint.
router.use(cognitoRouter);
router.use(registrationRouter);
router.use(passwordRouter);
router.use(accountRouter);
router.use(ssoRouter);
router.use(oauthMicrosoftRouter);
router.use(oauthGithubRouter);

export default router;
