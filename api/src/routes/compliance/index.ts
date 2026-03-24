import { Router } from "express";
import { authenticateUser } from "../../middleware/auth.js";
import { requireCurrentTos } from "../../middleware/tos.js";
import soc2Router from "./soc2.js";
import siemRouter from "./siem.js";
import dataResidencyRouter from "./data-residency.js";
import aiAuditRouter from "./ai-audit.js";
import cmekRouter from "./cmek.js";

const router = Router();

router.use(authenticateUser);
router.use(requireCurrentTos);

router.use(soc2Router);
router.use(siemRouter);
router.use(dataResidencyRouter);
router.use(aiAuditRouter);
router.use(cmekRouter);

export default router;
