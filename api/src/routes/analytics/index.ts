import { Router } from "express";
import { authenticateUser } from "../../middleware/auth.js";
import { requireCurrentTos } from "../../middleware/tos.js";
import tasksRouter from "./tasks.js";
import costsRouter from "./costs.js";
import qualityRouter from "./quality.js";
import complexityRouter from "./complexity.js";
import efficiencyRouter from "./efficiency.js";

const router = Router();

// All analytics routes require authentication
router.use(authenticateUser);
router.use(requireCurrentTos);

// Mount all sub-routers
router.use(tasksRouter);
router.use(costsRouter);
router.use(qualityRouter);
router.use(complexityRouter);
router.use(efficiencyRouter);

export default router;
