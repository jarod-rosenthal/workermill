import { DataSource } from "typeorm";
import { config } from "../config/index.js";
import {
  Organization,
  User,
  UserOrganization,
  UserApiKey,
  WorkerTask,
  WorkerTaskLog,
  WorkerTaskError,
  WorkerCommand,
  WorkerContext,
  WorkerCheckIn,
  WorkerFileLock,
  WorkerResourceReservation,
  AuditLog,
  OrgInvite,
  Persona,
  PersonaDirective,
  PersonaScript,
  Project,
  BoardColumn,
  InternalTask,
  EmailLog,
  InboundEmailMapping,
  AuthorizedEmailSender,
  WebhookEndpoint,
} from "../models/index.js";
import { InitialSchema1704067200000 } from "./migrations/1704067200000-InitialSchema.js";
import { AddWorkerTaskColumns1704067200001 } from "./migrations/1704067200001-AddWorkerTaskColumns.js";
import { AddOrganizationSettings1704067200002 } from "./migrations/1704067200002-AddOrganizationSettings.js";
import { AddCountersResetAt1704067200003 } from "./migrations/1704067200003-AddCountersResetAt.js";
import { AddCostTracking1704067200004 } from "./migrations/1704067200004-AddCostTracking.js";
import { AddWorkflowColumns1704067200005 } from "./migrations/1704067200005-AddWorkflowColumns.js";
import { AddWorkerTaskLogs1704067200006 } from "./migrations/1704067200006-AddWorkerTaskLogs.js";
import { GenerateOrgApiKeys1704067200007 } from "./migrations/1704067200007-GenerateOrgApiKeys.js";
import { AddUniqueTaskConstraint1704067200008 } from "./migrations/1704067200008-AddUniqueTaskConstraint.js";
import { CleanupDuplicatesAndAddConstraint1704067200009 } from "./migrations/1704067200009-CleanupDuplicatesAndAddConstraint.js";
import { AddOrgSettings1704067200010 } from "./migrations/1704067200010-AddOrgSettings.js";
import { AddCompletedTaskDisplayMinutes1704067200011 } from "./migrations/1704067200011-AddCompletedTaskDisplayMinutes.js";
import { AddWorkflowModeColumns1704067200012 } from "./migrations/1704067200012-AddWorkflowModeColumns.js";
import { AddManagerEcsColumns1704067200013 } from "./migrations/1704067200013-AddManagerEcsColumns.js";
import { AddUserPreferences1704067200014 } from "./migrations/1704067200014-AddUserPreferences.js";
import { AddUserApiKeys1704067200015 } from "./migrations/1704067200015-AddUserApiKeys.js";
import { AddIntermediateTaskDisplayMinutes1704067200016 } from "./migrations/1704067200016-AddIntermediateTaskDisplayMinutes.js";
import { AddWorkerCoordination1704067200017 } from "./migrations/1704067200017-AddWorkerCoordination.js";
import { AddProviderSupport1704067200017 as AddProviderSupport } from "./migrations/1704067200017-AddProviderSupport.js";
import { AddRalphExecutionSettings1704067200018 } from "./migrations/1704067200018-AddRalphExecutionSettings.js";
import { AddBillingFields1704067200020 } from "./migrations/1704067200020-AddBillingFields.js";
import { AddAuditLogs1704067200021 } from "./migrations/1704067200021-AddAuditLogs.js";
import { AddOrgInvites1704067200021 as AddOrgInvites } from "./migrations/1704067200021-AddOrgInvites.js";
import { AddPersonaStudio1704067200022 } from "./migrations/1704067200022-AddPersonaStudio.js";
import { AddProviderRouting1704067200023 } from "./migrations/1704067200023-AddProviderRouting.js";
import { AddCompoundIndexes1705344000000 } from "./migrations/1705344000000-AddCompoundIndexes.js";
import { AddManagerProvider1705344000001 } from "./migrations/1705344000001-AddManagerProvider.js";
import { AddVllmBaseUrl1705344000002 } from "./migrations/1705344000002-AddVllmBaseUrl.js";
import { AddOllamaContextWindow1705344000003 } from "./migrations/1705344000003-AddOllamaContextWindow.js";
import { AddLogFullTextSearch1705344000004 } from "./migrations/1705344000004-AddLogFullTextSearch.js";
import { CreateWorkerCommands1705344000005 } from "./migrations/1705344000005-CreateWorkerCommands.js";
import { AddPrdOrchestration1705344000006 } from "./migrations/1705344000006-AddPrdOrchestration.js";
import { CreateWorkerContext1705344000007 } from "./migrations/1705344000007-CreateWorkerContext.js";
import { CreateProjects1705344000010 } from "./migrations/1705344000010-CreateProjects.js";
import { CreateBoardColumns1705344000011 } from "./migrations/1705344000011-CreateBoardColumns.js";
import { CreateInternalTasks1705344000012 } from "./migrations/1705344000012-CreateInternalTasks.js";
import { MakeJiraFieldsOptional1705344000013 } from "./migrations/1705344000013-MakeJiraFieldsOptional.js";
import { AddContextArchived1705344000014 } from "./migrations/1705344000014-AddContextArchived.js";
import { AddCostFirstSettings1705344000015 } from "./migrations/1705344000015-AddCostFirstSettings.js";
import { AddDryRunVisibilityMinutes1705344000016 } from "./migrations/1705344000016-AddDryRunVisibilityMinutes.js";
import { AddWebhookIdempotency1705344000017 } from "./migrations/1705344000017-AddWebhookIdempotency.js";
import { AddSecurityIndexes1705344000018 } from "./migrations/1705344000018-AddSecurityIndexes.js";
import { MakeUserOrgIdNullable1705344000019 } from "./migrations/1705344000019-MakeUserOrgIdNullable.js";
import { AddPartialTokensTracking1705344000020 } from "./migrations/1705344000020-AddPartialTokensTracking.js";
import { AddMultiPhasePlanningSettings1705344000021 } from "./migrations/1705344000021-AddMultiPhasePlanningSettings.js";
import { AddPlanningAgentSettings1705344000022 } from "./migrations/1705344000022-AddPlanningAgentSettings.js";
import { AddDependencyAuditorSetting1705344000023 } from "./migrations/1705344000023-AddDependencyAuditorSetting.js";
import { AddPipelineV2Fields1705344000024 } from "./migrations/1705344000024-AddPipelineV2Fields.js";
import { AddMultiPersonaFields1705344000025 } from "./migrations/1705344000025-AddMultiPersonaFields.js";
import { AddEmailInfrastructure1705344000026 } from "./migrations/1705344000026-AddEmailInfrastructure.js";
import { AddOrgEmailSettings1705344000027 } from "./migrations/1705344000027-AddOrgEmailSettings.js";
import { ExtendUserEmailPreferences1705344000028 } from "./migrations/1705344000028-ExtendUserEmailPreferences.js";
import { MakeWorkerContextTaskIdNullable1705344000029 } from "./migrations/1705344000029-MakeWorkerContextTaskIdNullable.js";
import { AddExecutionMode1705344000030 } from "./migrations/1705344000030-AddExecutionMode.js";
import { DropSubtasksJsonIndex1705344000031 } from "./migrations/1705344000031-DropSubtasksJsonIndex.js";
import { AddStoryReadyMessageType1705344000032 } from "./migrations/1705344000032-AddStoryReadyMessageType.js";
import { AddUserApiKeyOrgId1705344000033 } from "./migrations/1705344000033-AddUserApiKeyOrgId.js";
import { AddPlanningAgentProvider1705344000035 } from "./migrations/1705344000035-AddPlanningAgentProvider.js";
import { AddContextSessionId1705344000036 } from "./migrations/1705344000036-AddContextSessionId.js";
import { AddScmProviderSupport1705344000040 } from "./migrations/1705344000040-AddScmProviderSupport.js";
import { AddWorkerTaskErrors1705344000041 } from "./migrations/1705344000041-AddWorkerTaskErrors.js";
import { AddContextMessageTypes1705344000042 } from "./migrations/1705344000042-AddContextMessageTypes.js";
import { AddAutoWorkflowSettings1705344000043 } from "./migrations/1705344000043-AddAutoWorkflowSettings.js";
import { AddAutoImproveSettings1705344000044 } from "./migrations/1705344000044-AddAutoImproveSettings.js";
import { AddStandardSdkMode1705344000045 } from "./migrations/1705344000045-AddStandardSdkMode.js";
import { AddMultiTenantWebhooks1705344000050 } from "./migrations/1705344000050-AddMultiTenantWebhooks.js";
import { AddOrgIdToPersonaTables1705344000051 } from "./migrations/1705344000051-AddOrgIdToPersonaTables.js";
import { AddOrgIdToRemainingTables1705344000052 } from "./migrations/1705344000052-AddOrgIdToRemainingTables.js";
import { AddPersonaInferenceRules1705344000053 } from "./migrations/1705344000053-AddPersonaInferenceRules.js";
import { RenameOrgSlugToOncallshift1705344000054 } from "./migrations/1705344000054-RenameOrgSlugToOncallshift.js";
import { AddMultiOrgSupport1705344000055 } from "./migrations/1705344000055-AddMultiOrgSupport.js";
import { SeedSystemPersonas1705344000056 } from "./migrations/1705344000056-SeedSystemPersonas.js";
import { AddEpicExecutionFields1705344000057 } from "./migrations/1705344000057-AddEpicExecutionFields.js";
import { RenameToOncallshift1705344000058 } from "./migrations/1705344000058-RenameToOncallshift.js";
import { FixOncallshiftRename1705344000059 } from "./migrations/1705344000059-FixOncallshiftRename.js";
import { logger } from "../utils/logger.js";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: config.database.url,
  host: config.database.url ? undefined : config.database.host,
  port: config.database.url ? undefined : config.database.port,
  username: config.database.url ? undefined : config.database.username,
  password: config.database.url ? undefined : config.database.password,
  database: config.database.url ? undefined : config.database.name,
  // Connection pool configuration for optimal performance
  extra: {
    max: 20, // Maximum connections in pool
    min: 5, // Minimum connections to maintain
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Timeout for acquiring connection
  },
  entities: [
    Organization,
    User,
    UserOrganization,
    UserApiKey,
    WorkerTask,
    WorkerTaskLog,
    WorkerTaskError,
    WorkerCommand,
    WorkerContext,
    WorkerCheckIn,
    WorkerFileLock,
    WorkerResourceReservation,
    AuditLog,
    OrgInvite,
    Persona,
    PersonaDirective,
    PersonaScript,
    Project,
    BoardColumn,
    InternalTask,
    EmailLog,
    InboundEmailMapping,
    AuthorizedEmailSender,
    WebhookEndpoint,
  ],
  migrations: [
    InitialSchema1704067200000,
    AddWorkerTaskColumns1704067200001,
    AddOrganizationSettings1704067200002,
    AddCountersResetAt1704067200003,
    AddCostTracking1704067200004,
    AddWorkflowColumns1704067200005,
    AddWorkerTaskLogs1704067200006,
    GenerateOrgApiKeys1704067200007,
    AddUniqueTaskConstraint1704067200008,
    CleanupDuplicatesAndAddConstraint1704067200009,
    AddOrgSettings1704067200010,
    AddCompletedTaskDisplayMinutes1704067200011,
    AddWorkflowModeColumns1704067200012,
    AddManagerEcsColumns1704067200013,
    AddUserPreferences1704067200014,
    AddUserApiKeys1704067200015,
    AddIntermediateTaskDisplayMinutes1704067200016,
    AddWorkerCoordination1704067200017,
    AddProviderSupport,
    AddRalphExecutionSettings1704067200018,
    AddBillingFields1704067200020,
    AddAuditLogs1704067200021,
    AddOrgInvites,
    AddPersonaStudio1704067200022,
    AddProviderRouting1704067200023,
    AddCompoundIndexes1705344000000,
    AddManagerProvider1705344000001,
    AddVllmBaseUrl1705344000002,
    AddOllamaContextWindow1705344000003,
    AddLogFullTextSearch1705344000004,
    CreateWorkerCommands1705344000005,
    AddPrdOrchestration1705344000006,
    CreateWorkerContext1705344000007,
    CreateProjects1705344000010,
    CreateBoardColumns1705344000011,
    CreateInternalTasks1705344000012,
    MakeJiraFieldsOptional1705344000013,
    AddContextArchived1705344000014,
    AddCostFirstSettings1705344000015,
    AddDryRunVisibilityMinutes1705344000016,
    AddWebhookIdempotency1705344000017,
    AddSecurityIndexes1705344000018,
    MakeUserOrgIdNullable1705344000019,
    AddPartialTokensTracking1705344000020,
    AddMultiPhasePlanningSettings1705344000021,
    AddPlanningAgentSettings1705344000022,
    AddDependencyAuditorSetting1705344000023,
    AddPipelineV2Fields1705344000024,
    AddMultiPersonaFields1705344000025,
    AddEmailInfrastructure1705344000026,
    AddOrgEmailSettings1705344000027,
    ExtendUserEmailPreferences1705344000028,
    MakeWorkerContextTaskIdNullable1705344000029,
    AddExecutionMode1705344000030,
    DropSubtasksJsonIndex1705344000031,
    AddStoryReadyMessageType1705344000032,
    AddUserApiKeyOrgId1705344000033,
    AddPlanningAgentProvider1705344000035,
    AddContextSessionId1705344000036,
    AddScmProviderSupport1705344000040,
    AddWorkerTaskErrors1705344000041,
    AddContextMessageTypes1705344000042,
    AddAutoWorkflowSettings1705344000043,
    AddAutoImproveSettings1705344000044,
    AddStandardSdkMode1705344000045,
    AddMultiTenantWebhooks1705344000050,
    AddOrgIdToPersonaTables1705344000051,
    AddOrgIdToRemainingTables1705344000052,
    AddPersonaInferenceRules1705344000053,
    RenameOrgSlugToOncallshift1705344000054,
    AddMultiOrgSupport1705344000055,
    SeedSystemPersonas1705344000056,
    AddEpicExecutionFields1705344000057,
    RenameToOncallshift1705344000058,
    FixOncallshiftRename1705344000059,
  ],
  synchronize: false, // Use migrations in production
  logging: config.nodeEnv === "development",
  ssl: config.database.url?.includes("rds.amazonaws.com")
    ? { rejectUnauthorized: false }
    : false,
});

export async function initializeDatabase(): Promise<DataSource> {
  try {
    await AppDataSource.initialize();
    logger.info("Database connection established");

    // Run pending migrations automatically on startup
    // This ensures schema is always in sync without manual intervention
    const pendingMigrations = await AppDataSource.showMigrations();
    if (pendingMigrations) {
      logger.info("Running pending database migrations...");
      const migrations = await AppDataSource.runMigrations();
      if (migrations.length > 0) {
        logger.info(`Completed ${migrations.length} migrations`, {
          migrations: migrations.map((m) => m.name),
        });
      }
    } else {
      logger.info("Database schema is up to date");
    }

    return AppDataSource;
  } catch (error) {
    logger.error("Error connecting to database", { error });
    throw error;
  }
}

export async function runMigrations(): Promise<void> {
  try {
    const migrations = await AppDataSource.runMigrations();
    if (migrations.length > 0) {
      logger.info(`Ran ${migrations.length} migrations`, {
        migrations: migrations.map((m) => m.name),
      });
    }
    logger.info("Migrations completed");
  } catch (error) {
    logger.error("Error running migrations", { error });
    throw error;
  }
}
