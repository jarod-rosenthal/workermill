import fs from "fs";
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
  WorkerTaskTokenUsage,
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
  DirectiveExperiment,
  Project,
  BoardColumn,
  InternalTask,
  EmailLog,
  InboundEmailMapping,
  AuthorizedEmailSender,
  WebhookEndpoint,
  CreditTransaction,
  PaymentMethod,
  WarmContainer,
  Referral,
  SupportTicket,
  SupportTicketMessage,
  SemanticMemory,
  EpisodicMemory,
  ProceduralMemory,
  PrFeedback,
  TaskRelationship,
  CodebaseIndex,
  CodebaseIndexStatus,
  ShowcaseProject,
  RemoteAgent,
  KbBoard,
  KbColumn,
  KbCard,
  KbLabel,
  KbCardLabel,
  KbComment,
  KbChecklist,
  KbActivity,
  KbStarredBoard,
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
import { AddCreditBillingTables1705344000060 } from "./migrations/1705344000060-AddCreditBillingTables.js";
import { CleanupTestUsers1705344000061 } from "./migrations/1705344000061-CleanupTestUsers.js";
import { AddWarmContainerPool1705344000062 } from "./migrations/1705344000062-AddWarmContainerPool.js";
import { AddProvidersUsedColumn1705344000063 } from "./migrations/1705344000063-AddProvidersUsedColumn.js";
import { AddEffectivenessTracking1705344000064 } from "./migrations/1705344000064-AddEffectivenessTracking.js";
import { AddReferralsTable1705344000065 } from "./migrations/1705344000065-AddReferralsTable.js";
import { AddSupportTicketsTables1705344000066 } from "./migrations/1705344000066-AddSupportTicketsTables.js";
import { AddPlanningTokensColumns1705344000067 } from "./migrations/1705344000067-AddPlanningTokensColumns.js";
import { AddSupportAgentColumns1705344000068 } from "./migrations/1705344000068-AddSupportAgentColumns.js";
import { AddTosAcceptanceFields1705344000069 } from "./migrations/1705344000069-AddTosAcceptanceFields.js";
import { AddCodeQualityMetrics1705344000070 } from "./migrations/1705344000070-AddCodeQualityMetrics.js";
import { BackfillOncallshiftQualityMetrics1705344000071 } from "./migrations/1705344000071-BackfillOncallshiftQualityMetrics.js";
import { AddAzureTenantIdToOrganization1705344000072 } from "./migrations/1705344000072-AddAzureTenantIdToOrganization.js";
import { ClearBackfilledQualityMetrics1705344000073 } from "./migrations/1705344000073-ClearBackfilledQualityMetrics.js";
import { CreateWorkerTaskTokenUsage1705344000074 } from "./migrations/1705344000074-CreateWorkerTaskTokenUsage.js";
import { AddBudgetLimitColumns1705344000075 } from "./migrations/1705344000075-AddBudgetLimitColumns.js";
import { CreateSemanticMemory1705344000076 } from "./migrations/1705344000076-CreateSemanticMemory.js";
import { CreateEpisodicMemory1705344000077 } from "./migrations/1705344000077-CreateEpisodicMemory.js";
import { CreateProceduralMemory1705344000078 } from "./migrations/1705344000078-CreateProceduralMemory.js";
import { AddPerTaskCostCeiling1705344000079 } from "./migrations/1705344000079-AddPerTaskCostCeiling.js";
import { AddBudgetOverrideColumns1705344000080 } from "./migrations/1705344000080-AddBudgetOverrideColumns.js";
import { AddQualityGateSettings1705344000081 } from "./migrations/1705344000081-AddQualityGateSettings.js";
import { CreatePrFeedback1705344000082 } from "./migrations/1705344000082-CreatePrFeedback.js";
import { AddPrFeedbackResolution1705344000083 } from "./migrations/1705344000083-AddPrFeedbackResolution.js";
import { AddQualityGateBypassField1705344000084 } from "./migrations/1705344000084-AddQualityGateBypassField.js";
import { AddSonarQubeIntegration1705344000085 } from "./migrations/1705344000085-AddSonarQubeIntegration.js";
import { AddCodeRabbitIntegration1705344000086 } from "./migrations/1705344000086-AddCodeRabbitIntegration.js";
import { AddDeepSourceIntegration1705344000087 } from "./migrations/1705344000087-AddDeepSourceIntegration.js";
import { AddQualityWebhookSupport1705344000088 } from "./migrations/1705344000088-AddQualityWebhookSupport.js";
import { AddSiemIntegration1705344000089 } from "./migrations/1705344000089-AddSiemIntegration.js";
import { CreateTaskRelationships1705344000090 } from "./migrations/1705344000090-CreateTaskRelationships.js";
import { AddCmekSupport1705344000091 } from "./migrations/1705344000091-AddCmekSupport.js";
import { AddAutoFixSettings1705344000092 } from "./migrations/1705344000092-AddAutoFixSettings.js";
import { SetupEnterpriseOrgs1705344000093 } from "./migrations/1705344000093-SetupEnterpriseOrgs.js";
import { AddManagerProviderToTask1705344000094 } from "./migrations/1705344000094-AddManagerProviderToTask.js";
import { AddMaxReviewRevisions1705344000095 } from "./migrations/1705344000095-AddMaxReviewRevisions.js";
import { AddAutoSkillExtraction1705344000096 } from "./migrations/1705344000096-AddAutoSkillExtraction.js";
import { AddSupportAdminColumn1705344000097 } from "./migrations/1705344000097-AddSupportAdminColumn.js";
import { CreateCodebaseIndex1705344000100 } from "./migrations/1705344000100-CreateCodebaseIndex.js";
import { CreateCodebaseIndexStatus1705344000101 } from "./migrations/1705344000101-CreateCodebaseIndexStatus.js";
import { AddCodebaseSettings1705344000102 } from "./migrations/1705344000102-AddCodebaseSettings.js";
import { AddDirectiveUsageTracking1705344000110 } from "./migrations/1705344000110-AddDirectiveUsageTracking.js";
import { CreateDirectiveExperiments1705344000111 } from "./migrations/1705344000111-CreateDirectiveExperiments.js";
import { BackfillUserOrganizations1705344000120 } from "./migrations/1705344000120-BackfillUserOrganizations.js";
import { SetSupportAdminForJarod1705344000121 } from "./migrations/1705344000121-SetSupportAdminForJarod.js";
import { DiagnoseBradUser1705344000122 } from "./migrations/1705344000122-DiagnoseBradUser.js";
import { DiagnoseBradOrg1705344000123 } from "./migrations/1705344000123-DiagnoseBradOrg.js";
import { AddJarodToBradOrg1705344000124 } from "./migrations/1705344000124-AddJarodToBradOrg.js";
import { DiagnoseOtherInvites1705344000125 } from "./migrations/1705344000125-DiagnoseOtherInvites.js";
import { MigrateMevionUsers1705344000126 } from "./migrations/1705344000126-MigrateMevionUsers.js";
import { MoveUsersToBradOrg1705344000127 } from "./migrations/1705344000127-MoveUsersToBradOrg.js";
import { CleanupStaleInvites1705344000128 } from "./migrations/1705344000128-CleanupStaleInvites.js";
import { RenameBradOrgToMevion1705344000129 } from "./migrations/1705344000129-RenameBradOrgToMevion.js";
import { AddPlatformOrgFlag1705344000200 } from "./migrations/1705344000200-AddPlatformOrgFlag.js";
import { AddBillingOrgId1705344000201 } from "./migrations/1705344000201-AddBillingOrgId.js";
import { CreatePlatformOrg1705344000202 } from "./migrations/1705344000202-CreatePlatformOrg.js";
import { FixPlatformOrgUuid1705344000203 } from "./migrations/1705344000203-FixPlatformOrgUuid.js";
import { FixAuditLogsColumns1706688000000 } from "./migrations/1706688000000-FixAuditLogsColumns.js";
import { AddIssueTrackerProvider1706688000001 } from "./migrations/1706688000001-AddIssueTrackerProvider.js";
import { DeleteJarod120Invite1706688000002 } from "./migrations/1706688000002-DeleteJarod120Invite.js";
import { SyncUserOrgIdWithDefault1706688000003 } from "./migrations/1706688000003-SyncUserOrgIdWithDefault.js";
import { ConfigurePlatformOrgSettings1706688000004 } from "./migrations/1706688000004-ConfigurePlatformOrgSettings.js";
import { FixMevionUsersAndCleanupOrgs1706688000005 } from "./migrations/1706688000005-FixMevionUsersAndCleanupOrgs.js";
import { CleanupJarod120User1706688000006 } from "./migrations/1706688000006-CleanupJarod120User.js";
import { DeleteJarodTestUsers1706688000007 } from "./migrations/1706688000007-DeleteJarodTestUsers.js";
import { DeleteJarodTestUsersAgain1706688000008 } from "./migrations/1706688000008-DeleteJarodTestUsersAgain.js";
import { DeleteJarod120ForInviteTest1706688000009 } from "./migrations/1706688000009-DeleteJarod120ForInviteTest.js";
import { AddDefaultBitbucketRepo1706688000010 } from "./migrations/1706688000010-AddDefaultBitbucketRepo.js";
import { AddPersonaKeywordPattern1706688000011 } from "./migrations/1706688000011-AddPersonaKeywordPattern.js";
import { UpdateDirectivesWithFullContent1706688000012 } from "./migrations/1706688000012-UpdateDirectivesWithFullContent.js";
import { UpdateAllPersonaDirectives1706688000013 } from "./migrations/1706688000013-UpdateAllPersonaDirectives.js";
import { SeedAllRemainingDirectives1706688000014 } from "./migrations/1706688000014-SeedAllRemainingDirectives.js";
import { SeedMissingPersonaDirectives1706688000015 } from "./migrations/1706688000015-SeedMissingPersonaDirectives.js";
import { SeedRemainingPersonaDirectives1706688000016 } from "./migrations/1706688000016-SeedRemainingPersonaDirectives.js";
import { ForceUpdateAllDirectives1706688000017 } from "./migrations/1706688000017-ForceUpdateAllDirectives.js";
import { AddFeatureFlagsToOrganization1706688000018 } from "./migrations/1706688000018-AddFeatureFlagsToOrganization.js";
import { AddResilienceSettings1706688000019 } from "./migrations/1706688000019-AddResilienceSettings.js";
import { AddSelfReviewEnabled1706688000020 } from "./migrations/1706688000020-AddSelfReviewEnabled.js";
import { AddBlockerMessageTypes1706688000021 } from "./migrations/1706688000021-AddBlockerMessageTypes.js";
import { AddInsightToProceduralMemory1706688000022 } from "./migrations/1706688000022-AddInsightToProceduralMemory.js";
import { CreateShowcaseProjects1706688000023 } from "./migrations/1706688000023-CreateShowcaseProjects.js";
import { SeedShowcaseProjects1706688000024 } from "./migrations/1706688000024-SeedShowcaseProjects.js";
import { AddRemoteAgentFields1706688000025 } from "./migrations/1706688000025-AddRemoteAgentFields.js";
import { CreateRemoteAgentsTable1706688000030 } from "./migrations/1706688000030-CreateRemoteAgentsTable.js";
import { UpdateDefaultModelsOpus461706688000031 } from "./migrations/1706688000031-UpdateDefaultModelsOpus46.js";
import { ChangeVectorDimensionsTo7681706688000032 } from "./migrations/1706688000032-ChangeVectorDimensionsTo768.js";
import { AddAgentVersionColumn1706688000033 } from "./migrations/1706688000033-AddAgentVersionColumn.js";
import { AddRepositoriesList1706688000034 } from "./migrations/1706688000034-AddRepositoriesList.js";
import { AddRemoteAgentOnlyMode1706688000035 } from "./migrations/1706688000035-AddRemoteAgentOnlyMode.js";
import { AddMaxParallelExperts1706688000036 } from "./migrations/1706688000036-AddMaxParallelExperts.js";
import { CreateKanbanBoards1706688000040 } from "./migrations/1706688000040-CreateKanbanBoards.js";
import { SeedKanbanDemoData1706688000041 } from "./migrations/1706688000041-SeedKanbanDemoData.js";
import { AddWorkerTaskToKbCards1706688000042 } from "./migrations/1706688000042-AddWorkerTaskToKbCards.js";
import { AddTicketSystemBackfill1706688000043 } from "./migrations/1706688000043-AddTicketSystemBackfill.js";
import { AddMaxPerStoryRevisions1706688000044 } from "./migrations/1706688000044-AddMaxPerStoryRevisions.js";
import { UpdateBoardColumns1706688000045 } from "./migrations/1706688000045-UpdateBoardColumns.js";
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
    max: 10, // Maximum connections in pool (db.t4g.micro supports ~22 total; keep headroom for rolling deploys)
    min: 2, // Minimum connections to maintain
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
    WorkerTaskTokenUsage,
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
    DirectiveExperiment,
    Project,
    BoardColumn,
    InternalTask,
    EmailLog,
    InboundEmailMapping,
    AuthorizedEmailSender,
    WebhookEndpoint,
    CreditTransaction,
    PaymentMethod,
    WarmContainer,
    Referral,
    SupportTicket,
    SupportTicketMessage,
    SemanticMemory,
    EpisodicMemory,
    ProceduralMemory,
    PrFeedback,
    TaskRelationship,
    CodebaseIndex,
    CodebaseIndexStatus,
    ShowcaseProject,
    RemoteAgent,
    KbBoard,
    KbColumn,
    KbCard,
    KbLabel,
    KbCardLabel,
    KbComment,
    KbChecklist,
    KbActivity,
    KbStarredBoard,
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
    AddCreditBillingTables1705344000060,
    CleanupTestUsers1705344000061,
    AddWarmContainerPool1705344000062,
    AddProvidersUsedColumn1705344000063,
    AddEffectivenessTracking1705344000064,
    AddReferralsTable1705344000065,
    AddSupportTicketsTables1705344000066,
    AddPlanningTokensColumns1705344000067,
    AddSupportAgentColumns1705344000068,
    AddTosAcceptanceFields1705344000069,
    AddCodeQualityMetrics1705344000070,
    BackfillOncallshiftQualityMetrics1705344000071,
    AddAzureTenantIdToOrganization1705344000072,
    ClearBackfilledQualityMetrics1705344000073,
    CreateWorkerTaskTokenUsage1705344000074,
    AddBudgetLimitColumns1705344000075,
    CreateSemanticMemory1705344000076,
    CreateEpisodicMemory1705344000077,
    CreateProceduralMemory1705344000078,
    AddPerTaskCostCeiling1705344000079,
    AddBudgetOverrideColumns1705344000080,
    AddQualityGateSettings1705344000081,
    CreatePrFeedback1705344000082,
    AddPrFeedbackResolution1705344000083,
    AddQualityGateBypassField1705344000084,
    AddSonarQubeIntegration1705344000085,
    AddCodeRabbitIntegration1705344000086,
    AddDeepSourceIntegration1705344000087,
    AddQualityWebhookSupport1705344000088,
    AddSiemIntegration1705344000089,
    CreateTaskRelationships1705344000090,
    AddCmekSupport1705344000091,
    AddAutoFixSettings1705344000092,
    SetupEnterpriseOrgs1705344000093,
    AddManagerProviderToTask1705344000094,
    AddMaxReviewRevisions1705344000095,
    AddAutoSkillExtraction1705344000096,
    AddSupportAdminColumn1705344000097,
    CreateCodebaseIndex1705344000100,
    CreateCodebaseIndexStatus1705344000101,
    AddCodebaseSettings1705344000102,
    AddDirectiveUsageTracking1705344000110,
    CreateDirectiveExperiments1705344000111,
    BackfillUserOrganizations1705344000120,
    SetSupportAdminForJarod1705344000121,
    DiagnoseBradUser1705344000122,
    DiagnoseBradOrg1705344000123,
    AddJarodToBradOrg1705344000124,
    DiagnoseOtherInvites1705344000125,
    MigrateMevionUsers1705344000126,
    MoveUsersToBradOrg1705344000127,
    CleanupStaleInvites1705344000128,
    RenameBradOrgToMevion1705344000129,
    AddPlatformOrgFlag1705344000200,
    AddBillingOrgId1705344000201,
    CreatePlatformOrg1705344000202,
    FixPlatformOrgUuid1705344000203,
    FixAuditLogsColumns1706688000000,
    AddIssueTrackerProvider1706688000001,
    DeleteJarod120Invite1706688000002,
    SyncUserOrgIdWithDefault1706688000003,
    ConfigurePlatformOrgSettings1706688000004,
    FixMevionUsersAndCleanupOrgs1706688000005,
    CleanupJarod120User1706688000006,
    DeleteJarodTestUsers1706688000007,
    DeleteJarodTestUsersAgain1706688000008,
    DeleteJarod120ForInviteTest1706688000009,
    AddDefaultBitbucketRepo1706688000010,
    AddPersonaKeywordPattern1706688000011,
    UpdateDirectivesWithFullContent1706688000012,
    UpdateAllPersonaDirectives1706688000013,
    SeedAllRemainingDirectives1706688000014,
    SeedMissingPersonaDirectives1706688000015,
    SeedRemainingPersonaDirectives1706688000016,
    ForceUpdateAllDirectives1706688000017,
    AddFeatureFlagsToOrganization1706688000018,
    AddResilienceSettings1706688000019,
    AddSelfReviewEnabled1706688000020,
    AddBlockerMessageTypes1706688000021,
    AddInsightToProceduralMemory1706688000022,
    CreateShowcaseProjects1706688000023,
    SeedShowcaseProjects1706688000024,
    AddRemoteAgentFields1706688000025,
    CreateRemoteAgentsTable1706688000030,
    UpdateDefaultModelsOpus461706688000031,
    ChangeVectorDimensionsTo7681706688000032,
    AddAgentVersionColumn1706688000033,
    AddRepositoriesList1706688000034,
    AddRemoteAgentOnlyMode1706688000035,
    AddMaxParallelExperts1706688000036,
    CreateKanbanBoards1706688000040,
    SeedKanbanDemoData1706688000041,
    AddWorkerTaskToKbCards1706688000042,
    AddTicketSystemBackfill1706688000043,
    AddMaxPerStoryRevisions1706688000044,
    UpdateBoardColumns1706688000045,
  ],
  synchronize: false, // Use migrations in production
  logging: config.nodeEnv === "development",
  // Enable SSL for RDS connections (direct or via bastion tunnel)
  // - Direct RDS: URL contains rds.amazonaws.com
  // - Via tunnel: URL contains sslmode=require
  ssl:
    config.database.url?.includes("rds.amazonaws.com") ||
    config.database.url?.includes("sslmode=require")
      ? {
          rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
          ...(fs.existsSync("/app/rds-combined-ca-bundle.pem")
            ? { ca: [fs.readFileSync("/app/rds-combined-ca-bundle.pem", "utf8")] }
            : {}),
        }
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
