import { Router } from "express";
import { authenticateUser } from "../../middleware/auth.js";
import { requireCurrentTos } from "../../middleware/tos.js";
import boardCrudRouter from "./board-crud.js";
import columnsRouter from "./columns.js";
import cardsRouter from "./cards.js";
import labelsRouter from "./labels.js";
import commentsChecklistsRouter from "./comments-checklists.js";
import activityAttachmentsRouter from "./activity-attachments.js";

const router = Router();

router.use(authenticateUser);
router.use(requireCurrentTos);

router.use(boardCrudRouter);
router.use(columnsRouter);
router.use(cardsRouter);
router.use(labelsRouter);
router.use(commentsChecklistsRouter);
router.use(activityAttachmentsRouter);

export default router;
export { runCardAsWorkerTask } from "./helpers.js";
