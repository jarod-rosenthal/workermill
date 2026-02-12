/**
 * Support Ticket Routes
 *
 * API endpoints for the support ticket system:
 * - Create, list, and update support tickets
 * - Add and view messages on tickets
 * - Admin endpoints for ticket management
 */

import { Router, Request, Response } from "express";
import { authenticateUser, authenticateApiKey } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { body, param, query, validateRequest } from "../middleware/validation.js";
import { AppDataSource } from "../db/connection.js";
import {
  SupportTicket,
  SupportTicketMessage,
  User,
  type SupportTicketStatus,
  type SupportTicketPriority,
  type SupportTicketCategory,
} from "../models/index.js";
import { NotFoundError, BadRequestError, ForbiddenError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { sendSupportTicketEmail } from "../services/email/index.js";
import { config } from "../config/index.js";
import { triggerSupportAgentTask } from "../services/support-agent.js";

const router = Router();

// Valid values for validation
const VALID_STATUSES: SupportTicketStatus[] = ["open", "in_progress", "waiting", "resolved", "closed"];
const VALID_PRIORITIES: SupportTicketPriority[] = ["low", "medium", "high", "urgent"];
const VALID_CATEGORIES: SupportTicketCategory[] = ["general", "billing", "technical", "feature_request", "bug_report"];

/**
 * Generate next ticket key for organization
 * Uses PostgreSQL sequence for unique numbering
 */
async function generateTicketKey(): Promise<string> {
  const result = await AppDataSource.query(
    `SELECT nextval('support_ticket_seq') as seq`
  );
  const seq = result[0].seq;
  return `SUP-${String(seq).padStart(3, "0")}`;
}

/**
 * @swagger
 * /api/support/tickets:
 *   get:
 *     summary: List support tickets
 *     description: Returns tickets for the current user's organization
 *     tags: [Support]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, in_progress, waiting, resolved, closed]
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of tickets
 */
router.get(
  "/tickets",
  authenticateUser,
  [
    query("status").optional().isIn(VALID_STATUSES),
    query("category").optional().isIn(VALID_CATEGORIES),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("offset").optional().isInt({ min: 0 }).toInt(),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.organization!.id;
    const userId = req.user!.id;
    const isSupportAdmin = req.user!.supportAdmin === true;
    const { status, category, limit = 50, offset = 0 } = req.query;

    // Regular users must belong to an organization
    if (!isSupportAdmin && !orgId) {
      throw new BadRequestError("User must belong to an organization");
    }

    const ticketRepo = AppDataSource.getRepository(SupportTicket);

    const queryBuilder = ticketRepo
      .createQueryBuilder("ticket")
      .leftJoinAndSelect("ticket.creator", "creator")
      .leftJoinAndSelect("ticket.assignee", "assignee")
      .leftJoinAndSelect("ticket.organization", "organization");

    // Support admins see ALL tickets from all organizations
    // Regular admins see all tickets from their org
    // Regular users see only their own tickets
    if (isSupportAdmin) {
      // Support admins can see everything - no org filter
    } else if ((req.orgRole === "admin" || req.orgRole === "owner")) {
      queryBuilder.where("ticket.orgId = :orgId", { orgId });
    } else {
      queryBuilder
        .where("ticket.orgId = :orgId", { orgId })
        .andWhere("ticket.createdBy = :userId", { userId });
    }

    if (status) {
      queryBuilder.andWhere("ticket.status = :status", { status });
    }

    if (category) {
      queryBuilder.andWhere("ticket.category = :category", { category });
    }

    const [tickets, total] = await queryBuilder
      .orderBy("ticket.createdAt", "DESC")
      .skip(Number(offset))
      .take(Number(limit))
      .getManyAndCount();

    res.json({
      tickets: tickets.map((t) => ({
        id: t.id,
        ticketKey: t.ticketKey,
        subject: t.subject,
        status: t.status,
        statusDisplay: t.getDisplayStatus(),
        priority: t.priority,
        category: t.category,
        createdBy: t.creator
          ? { id: t.creator.id, email: t.creator.email, fullName: t.creator.fullName }
          : null,
        assignedTo: t.assignee
          ? { id: t.assignee.id, email: t.assignee.email, fullName: t.assignee.fullName }
          : null,
        // Include organization info for support admins
        organization: isSupportAdmin && t.organization
          ? { id: t.organization.id, name: t.organization.name, slug: t.organization.slug }
          : undefined,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        resolvedAt: t.resolvedAt,
        closedAt: t.closedAt,
      })),
      total,
      limit: Number(limit),
      offset: Number(offset),
      isSupportAdmin,
    });
  })
);

/**
 * @swagger
 * /api/support/tickets/{id}:
 *   get:
 *     summary: Get ticket details with messages
 *     tags: [Support]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ticket details with messages
 */
router.get(
  "/tickets/:id",
  authenticateUser,
  [param("id").isUUID(), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const orgId = req.organization!.id;
    const userId = req.user!.id;

    if (!orgId) {
      throw new BadRequestError("User must belong to an organization");
    }

    const ticketRepo = AppDataSource.getRepository(SupportTicket);
    const ticket = await ticketRepo.findOne({
      where: { id, orgId },
      relations: ["creator", "assignee", "messages", "messages.author"],
    });

    if (!ticket) {
      throw new NotFoundError("Ticket not found");
    }

    // Non-admin users can only view their own tickets
    if ((req.orgRole !== "admin" && req.orgRole !== "owner") && ticket.createdBy !== userId) {
      throw new ForbiddenError("You don't have permission to view this ticket");
    }

    // Filter out internal messages for non-admin users
    const messages = ticket.messages
      .filter((m) => (req.orgRole === "admin" || req.orgRole === "owner") || !m.isInternal)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => ({
        id: m.id,
        content: m.content,
        isInternal: m.isInternal,
        isFromSupport: m.isFromSupport,
        author: m.author
          ? { id: m.author.id, email: m.author.email, fullName: m.author.fullName }
          : null,
        authorEmail: m.authorEmail,
        displayAuthor: m.getDisplayAuthor(),
        attachments: m.attachments,
        createdAt: m.createdAt,
      }));

    res.json({
      ticket: {
        id: ticket.id,
        ticketKey: ticket.ticketKey,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        statusDisplay: ticket.getDisplayStatus(),
        priority: ticket.priority,
        category: ticket.category,
        createdBy: ticket.creator
          ? { id: ticket.creator.id, email: ticket.creator.email, fullName: ticket.creator.fullName }
          : null,
        assignedTo: ticket.assignee
          ? { id: ticket.assignee.id, email: ticket.assignee.email, fullName: ticket.assignee.fullName }
          : null,
        metadata: ticket.metadata,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        resolvedAt: ticket.resolvedAt,
        closedAt: ticket.closedAt,
      },
      messages,
    });
  })
);

/**
 * @swagger
 * /api/support/tickets:
 *   post:
 *     summary: Create a new support ticket
 *     tags: [Support]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subject
 *               - description
 *             properties:
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, urgent]
 *               category:
 *                 type: string
 *                 enum: [general, billing, technical, feature_request, bug_report]
 *     responses:
 *       201:
 *         description: Ticket created
 */
router.post(
  "/tickets",
  authenticateUser,
  [
    body("subject").isString().trim().isLength({ min: 1, max: 500 }),
    body("description").isString().trim().isLength({ min: 1, max: 10000 }),
    body("priority").optional().isIn(VALID_PRIORITIES),
    body("category").optional().isIn(VALID_CATEGORIES),
    body("metadata").optional().isObject(),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const { subject, description, priority = "medium", category = "general", metadata } = req.body;
    const orgId = req.organization!.id;
    const userId = req.user!.id;

    if (!orgId) {
      throw new BadRequestError("User must belong to an organization");
    }

    const ticketKey = await generateTicketKey();

    const ticketRepo = AppDataSource.getRepository(SupportTicket);
    const ticket = ticketRepo.create({
      ticketKey,
      subject,
      description,
      status: "open" as SupportTicketStatus,
      priority: priority as SupportTicketPriority,
      category: category as SupportTicketCategory,
      orgId,
      createdBy: userId,
      metadata,
    });

    await ticketRepo.save(ticket);

    logger.info("Support ticket created", {
      ticketId: ticket.id,
      ticketKey: ticket.ticketKey,
      orgId,
      userId,
      category,
    });

    // Send confirmation email to user
    try {
      await sendSupportTicketEmail(req.user!.email, "created", ticket);
    } catch (emailError) {
      logger.error("Failed to send ticket confirmation email", { ticketId: ticket.id, error: emailError });
    }

    // Trigger AI support agent if enabled
    let supportAgentTaskId: string | null = null;
    if (config.supportAgent.enabled) {
      try {
        const result = await triggerSupportAgentTask({
          ticketId: ticket.id,
          ticketKey: ticket.ticketKey,
          subject,
          description,
          category,
          priority,
          orgId,
          userId,
        });
        supportAgentTaskId = result.taskId;
        logger.info("Support agent task triggered", {
          ticketId: ticket.id,
          ticketKey: ticket.ticketKey,
          taskId: supportAgentTaskId,
          status: result.status,
        });
      } catch (agentError) {
        logger.error("Failed to trigger support agent", {
          ticketId: ticket.id,
          ticketKey: ticket.ticketKey,
          error: agentError,
        });
        // Don't fail ticket creation if support agent fails
      }
    }

    res.status(201).json({
      ticket: {
        id: ticket.id,
        ticketKey: ticket.ticketKey,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        createdAt: ticket.createdAt,
        supportAgentTaskId,
      },
      message: `Support ticket ${ticket.ticketKey} created successfully`,
    });
  })
);

/**
 * @swagger
 * /api/support/tickets/{id}:
 *   patch:
 *     summary: Update a support ticket
 *     tags: [Support]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               priority:
 *                 type: string
 *               assignedTo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ticket updated
 */
router.patch(
  "/tickets/:id",
  authenticateUser,
  [
    param("id").isUUID(),
    body("status").optional().isIn(VALID_STATUSES),
    body("priority").optional().isIn(VALID_PRIORITIES),
    body("category").optional().isIn(VALID_CATEGORIES),
    body("assignedTo").optional({ nullable: true }).isUUID(),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { status, priority, category, assignedTo } = req.body;
    const orgId = req.organization!.id;
    const userId = req.user!.id;

    if (!orgId) {
      throw new BadRequestError("User must belong to an organization");
    }

    const ticketRepo = AppDataSource.getRepository(SupportTicket);
    const ticket = await ticketRepo.findOne({
      where: { id, orgId },
      relations: ["creator"],
    });

    if (!ticket) {
      throw new NotFoundError("Ticket not found");
    }

    // Non-admin users can only update their own tickets
    if ((req.orgRole !== "admin" && req.orgRole !== "owner") && ticket.createdBy !== userId) {
      throw new ForbiddenError("You don't have permission to update this ticket");
    }

    // Non-admin users can only update status (to close their own tickets)
    if ((req.orgRole !== "admin" && req.orgRole !== "owner")) {
      if (priority !== undefined || category !== undefined || assignedTo !== undefined) {
        throw new ForbiddenError("Only admins can update priority, category, or assignment");
      }
      // Users can only close/reopen their own tickets
      if (status && !["closed", "open"].includes(status)) {
        throw new ForbiddenError("Users can only close or reopen their tickets");
      }
    }

    // Validate status transition
    if (status && !ticket.canTransitionTo(status)) {
      throw new BadRequestError(`Cannot transition from ${ticket.status} to ${status}`);
    }

    // Update fields
    if (status) {
      ticket.status = status as SupportTicketStatus;
      if (status === "resolved") {
        ticket.resolvedAt = new Date();
      } else if (status === "closed") {
        ticket.closedAt = new Date();
      } else if (status === "open" && (ticket.resolvedAt || ticket.closedAt)) {
        // Reopening - clear timestamps
        ticket.resolvedAt = null;
        ticket.closedAt = null;
      }
    }

    if (priority !== undefined) {
      ticket.priority = priority as SupportTicketPriority;
    }

    if (category !== undefined) {
      ticket.category = category as SupportTicketCategory;
    }

    if (assignedTo !== undefined) {
      // Validate assignee exists
      if (assignedTo !== null) {
        const userRepo = AppDataSource.getRepository(User);
        const assignee = await userRepo.findOne({ where: { id: assignedTo } });
        if (!assignee) {
          throw new BadRequestError("Assignee not found");
        }
      }
      ticket.assignedTo = assignedTo;
    }

    await ticketRepo.save(ticket);

    logger.info("Support ticket updated", {
      ticketId: ticket.id,
      ticketKey: ticket.ticketKey,
      updates: { status, priority, category, assignedTo },
      updatedBy: userId,
    });

    // Send status update email if status changed
    if (status && ticket.creator) {
      try {
        await sendSupportTicketEmail(ticket.creator.email, "updated", ticket);
      } catch (emailError) {
        logger.error("Failed to send ticket update email", { ticketId: ticket.id, error: emailError });
      }
    }

    res.json({
      ticket: {
        id: ticket.id,
        ticketKey: ticket.ticketKey,
        status: ticket.status,
        statusDisplay: ticket.getDisplayStatus(),
        priority: ticket.priority,
        category: ticket.category,
        assignedTo: ticket.assignedTo,
        updatedAt: ticket.updatedAt,
      },
    });
  })
);

/**
 * @swagger
 * /api/support/tickets/{id}/messages:
 *   post:
 *     summary: Add a message to a ticket
 *     tags: [Support]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               isInternal:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Message added
 */
router.post(
  "/tickets/:id/messages",
  authenticateUser,
  [
    param("id").isUUID(),
    body("content").isString().trim().isLength({ min: 1, max: 10000 }),
    body("isInternal").optional().isBoolean(),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { content, isInternal = false } = req.body;
    const orgId = req.organization!.id;
    const userId = req.user!.id;

    if (!orgId) {
      throw new BadRequestError("User must belong to an organization");
    }

    const ticketRepo = AppDataSource.getRepository(SupportTicket);
    const ticket = await ticketRepo.findOne({
      where: { id, orgId },
      relations: ["creator"],
    });

    if (!ticket) {
      throw new NotFoundError("Ticket not found");
    }

    // Non-admin users can only message their own tickets
    if ((req.orgRole !== "admin" && req.orgRole !== "owner") && ticket.createdBy !== userId) {
      throw new ForbiddenError("You don't have permission to message this ticket");
    }

    // Only admins can add internal notes
    if (isInternal && (req.orgRole !== "admin" && req.orgRole !== "owner")) {
      throw new ForbiddenError("Only admins can add internal notes");
    }

    // Determine if this is a support response
    const isFromSupport = (req.orgRole === "admin" || req.orgRole === "owner") && ticket.createdBy !== userId;

    const messageRepo = AppDataSource.getRepository(SupportTicketMessage);
    const message = messageRepo.create({
      ticketId: ticket.id,
      content,
      isInternal,
      isFromSupport,
      authorId: userId,
    });

    await messageRepo.save(message);

    // Update ticket status if it's a support response on an open ticket
    if (isFromSupport && ticket.status === "open") {
      ticket.status = "in_progress";
      await ticketRepo.save(ticket);
    }

    // If user replied to a waiting ticket, move back to in_progress
    if (!isFromSupport && ticket.status === "waiting") {
      ticket.status = "in_progress";
      await ticketRepo.save(ticket);
    }

    logger.info("Support ticket message added", {
      ticketId: ticket.id,
      ticketKey: ticket.ticketKey,
      messageId: message.id,
      isInternal,
      isFromSupport,
      authorId: userId,
    });

    // Send email notification for support response (non-internal)
    if (isFromSupport && !isInternal && ticket.creator) {
      try {
        await sendSupportTicketEmail(ticket.creator.email, "reply", ticket, content);
      } catch (emailError) {
        logger.error("Failed to send ticket reply email", { ticketId: ticket.id, error: emailError });
      }
    }

    res.status(201).json({
      message: {
        id: message.id,
        content: message.content,
        isInternal: message.isInternal,
        isFromSupport: message.isFromSupport,
        createdAt: message.createdAt,
      },
    });
  })
);

/**
 * @swagger
 * /api/support/tickets/{id}/messages:
 *   get:
 *     summary: Get messages for a ticket
 *     tags: [Support]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get(
  "/tickets/:id/messages",
  authenticateUser,
  [param("id").isUUID(), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const orgId = req.organization!.id;
    const userId = req.user!.id;

    if (!orgId) {
      throw new BadRequestError("User must belong to an organization");
    }

    const ticketRepo = AppDataSource.getRepository(SupportTicket);
    const ticket = await ticketRepo.findOne({
      where: { id, orgId },
    });

    if (!ticket) {
      throw new NotFoundError("Ticket not found");
    }

    // Non-admin users can only view their own ticket messages
    if ((req.orgRole !== "admin" && req.orgRole !== "owner") && ticket.createdBy !== userId) {
      throw new ForbiddenError("You don't have permission to view this ticket");
    }

    const messageRepo = AppDataSource.getRepository(SupportTicketMessage);
    const queryBuilder = messageRepo
      .createQueryBuilder("message")
      .leftJoinAndSelect("message.author", "author")
      .where("message.ticketId = :ticketId", { ticketId: id });

    // Filter out internal messages for non-admin users
    if ((req.orgRole !== "admin" && req.orgRole !== "owner")) {
      queryBuilder.andWhere("message.isInternal = false");
    }

    const messages = await queryBuilder
      .orderBy("message.createdAt", "ASC")
      .getMany();

    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        content: m.content,
        isInternal: m.isInternal,
        isFromSupport: m.isFromSupport,
        author: m.author
          ? { id: m.author.id, email: m.author.email, fullName: m.author.fullName }
          : null,
        authorEmail: m.authorEmail,
        displayAuthor: m.getDisplayAuthor(),
        attachments: m.attachments,
        createdAt: m.createdAt,
      })),
    });
  })
);

/**
 * @swagger
 * /api/support/tickets/{id}/ai-response:
 *   post:
 *     summary: Post an AI-generated response to a support ticket (API key auth)
 *     tags: [Support]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       201:
 *         description: AI response posted successfully
 */
router.post(
  "/tickets/:id/ai-response",
  authenticateApiKey,
  [
    param("id").isUUID(),
    body("content").isString().trim().isLength({ min: 1, max: 50000 }),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { content } = req.body;
    const org = req.organization!;

    const ticketRepo = AppDataSource.getRepository(SupportTicket);
    const ticket = await ticketRepo.findOne({
      where: { id, orgId: org.id },
      relations: ["creator"],
    });

    if (!ticket) {
      throw new NotFoundError("Ticket not found");
    }

    // Create the AI response message
    const messageRepo = AppDataSource.getRepository(SupportTicketMessage);
    const message = messageRepo.create({
      ticketId: ticket.id,
      content,
      isInternal: false,
      isFromSupport: true,
      authorEmail: "AI Support Agent",
    });

    await messageRepo.save(message);

    // Update ticket with AI response info
    ticket.aiRespondedAt = new Date();
    if (ticket.status === "open") {
      ticket.status = "in_progress";
    }
    await ticketRepo.save(ticket);

    logger.info("AI support response posted", {
      ticketId: ticket.id,
      ticketKey: ticket.ticketKey,
      messageId: message.id,
    });

    // Send email notification to user
    if (ticket.creator) {
      try {
        await sendSupportTicketEmail(ticket.creator.email, "reply", ticket, content);
      } catch (emailError) {
        logger.warn("Failed to send AI response email notification", {
          ticketId: ticket.id,
          error: emailError instanceof Error ? emailError.message : String(emailError),
        });
      }
    }

    res.status(201).json({
      success: true,
      message: {
        id: message.id,
        content: message.content,
        createdAt: message.createdAt,
      },
    });
  })
);

/**
 * @swagger
 * /api/support/stats:
 *   get:
 *     summary: Get support ticket statistics (admin only)
 *     tags: [Support]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Support statistics
 */
router.get(
  "/stats",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.organization!.id;

    if (!orgId) {
      throw new BadRequestError("User must belong to an organization");
    }

    // Only admins can view stats
    if ((req.orgRole !== "admin" && req.orgRole !== "owner")) {
      throw new ForbiddenError("Only admins can view support statistics");
    }

    const ticketRepo = AppDataSource.getRepository(SupportTicket);

    // Count by status
    const statusCounts = await ticketRepo
      .createQueryBuilder("ticket")
      .select("ticket.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("ticket.orgId = :orgId", { orgId })
      .groupBy("ticket.status")
      .getRawMany();

    // Count by priority for open tickets
    const priorityCounts = await ticketRepo
      .createQueryBuilder("ticket")
      .select("ticket.priority", "priority")
      .addSelect("COUNT(*)", "count")
      .where("ticket.orgId = :orgId", { orgId })
      .andWhere("ticket.status NOT IN ('resolved', 'closed')")
      .groupBy("ticket.priority")
      .getRawMany();

    // Count by category
    const categoryCounts = await ticketRepo
      .createQueryBuilder("ticket")
      .select("ticket.category", "category")
      .addSelect("COUNT(*)", "count")
      .where("ticket.orgId = :orgId", { orgId })
      .groupBy("ticket.category")
      .getRawMany();

    // Calculate average resolution time (last 30 days)
    const avgResolutionTime = await ticketRepo
      .createQueryBuilder("ticket")
      .select("AVG(EXTRACT(EPOCH FROM (ticket.resolvedAt - ticket.createdAt)))", "avgSeconds")
      .where("ticket.orgId = :orgId", { orgId })
      .andWhere("ticket.resolvedAt IS NOT NULL")
      .andWhere("ticket.resolvedAt > NOW() - INTERVAL '30 days'")
      .getRawOne();

    res.json({
      byStatus: Object.fromEntries(statusCounts.map((r) => [r.status, parseInt(r.count)])),
      byPriority: Object.fromEntries(priorityCounts.map((r) => [r.priority, parseInt(r.count)])),
      byCategory: Object.fromEntries(categoryCounts.map((r) => [r.category, parseInt(r.count)])),
      avgResolutionTimeSeconds: avgResolutionTime?.avgSeconds
        ? Math.round(parseFloat(avgResolutionTime.avgSeconds))
        : null,
      avgResolutionTimeFormatted: avgResolutionTime?.avgSeconds
        ? formatDuration(parseFloat(avgResolutionTime.avgSeconds))
        : null,
    });
  })
);

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export default router;
