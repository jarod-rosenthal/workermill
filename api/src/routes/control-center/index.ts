import { Router } from "express";
import dashboardRouter from "./dashboard.js";
import streamRouter from "./stream.js";
import logsRouter from "./logs.js";
import actionsRouter from "./actions.js";
import searchRouter from "./search.js";

const router = Router();

// Mount all sub-routers (no path prefix - routes are defined with full paths)
router.use(dashboardRouter);
router.use(streamRouter);
router.use(logsRouter);
router.use(actionsRouter);
router.use(searchRouter);

export default router;
