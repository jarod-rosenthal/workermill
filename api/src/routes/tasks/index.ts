import { Router } from "express";
import crudRouter from "./crud.js";
import lifecycleRouter from "./lifecycle.js";
import plansRouter from "./plans.js";
import workerApiRouter from "./worker-api.js";
import usageRouter from "./usage.js";
import subtasksRouter from "./subtasks.js";

const router = Router();

// Mount all sub-routers (no prefix - routes use paths relative to /api/tasks)
router.use(crudRouter);
router.use(lifecycleRouter);
router.use(plansRouter);
router.use(workerApiRouter);
router.use(usageRouter);
router.use(subtasksRouter);

export default router;
