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
  KbCardDependency,
  KbComment,
  KbChecklist,
  KbActivity,
  KbStarredBoard,
  MarketingCampaign,
  MarketingContent,
  MarketingAction,
  OrgCredential,
  KbSpec,
  KbSpecTemplate,
  KbSpecVersion,
  KbCardAttachment,
  PushSubscription,
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
import { AddMultiOrgSupport1705344000055 } from "./migrations/1705344000055-AddMultiOrgSupport.js";
import { SeedSystemPersonas1705344000056 } from "./migrations/1705344000056-SeedSystemPersonas.js";
import { AddEpicExecutionFields1705344000057 } from "./migrations/1705344000057-AddEpicExecutionFields.js";
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
import { SetSupportAdminForUser1705344000121 } from "./migrations/1705344000121-SetSupportAdminForUser.js";
import { DiagnoseUser1705344000122 } from "./migrations/1705344000122-DiagnoseUser.js";
import { DiagnoseOrg1705344000123 } from "./migrations/1705344000123-DiagnoseOrg.js";
import { AddUserToOrg1705344000124 } from "./migrations/1705344000124-AddUserToOrg.js";
import { DiagnoseOtherInvites1705344000125 } from "./migrations/1705344000125-DiagnoseOtherInvites.js";
import { MigrateEnterpriseUsers1705344000126 } from "./migrations/1705344000126-MigrateEnterpriseUsers.js";
import { MoveUsersToOrg1705344000127 } from "./migrations/1705344000127-MoveUsersToOrg.js";
import { CleanupStaleInvites1705344000128 } from "./migrations/1705344000128-CleanupStaleInvites.js";
import { RenameOrgToEnterprise1705344000129 } from "./migrations/1705344000129-RenameOrgToEnterprise.js";
import { AddPlatformOrgFlag1705344000200 } from "./migrations/1705344000200-AddPlatformOrgFlag.js";
import { AddBillingOrgId1705344000201 } from "./migrations/1705344000201-AddBillingOrgId.js";
import { CreatePlatformOrg1705344000202 } from "./migrations/1705344000202-CreatePlatformOrg.js";
import { FixPlatformOrgUuid1705344000203 } from "./migrations/1705344000203-FixPlatformOrgUuid.js";
import { FixAuditLogsColumns1706688000000 } from "./migrations/1706688000000-FixAuditLogsColumns.js";
import { AddIssueTrackerProvider1706688000001 } from "./migrations/1706688000001-AddIssueTrackerProvider.js";
import { DeleteTestInvite1706688000002 } from "./migrations/1706688000002-DeleteTestInvite.js";
import { SyncUserOrgIdWithDefault1706688000003 } from "./migrations/1706688000003-SyncUserOrgIdWithDefault.js";
import { ConfigurePlatformOrgSettings1706688000004 } from "./migrations/1706688000004-ConfigurePlatformOrgSettings.js";
import { FixEnterpriseUsersAndCleanupOrgs1706688000005 } from "./migrations/1706688000005-FixEnterpriseUsersAndCleanupOrgs.js";
import { CleanupTestUser1706688000006 } from "./migrations/1706688000006-CleanupTestUser.js";
import { DeleteTestUsers1706688000007 } from "./migrations/1706688000007-DeleteTestUsers.js";
import { DeleteTestUsersAgain1706688000008 } from "./migrations/1706688000008-DeleteTestUsersAgain.js";
import { DeleteUserForInviteTest1706688000009 } from "./migrations/1706688000009-DeleteUserForInviteTest.js";
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
import { ChangeSelfReviewDefaultToFalse1706688000046 } from "./migrations/1706688000046-ChangeSelfReviewDefaultToFalse.js";
import { ConsolidatePlansToThreeTiers1706688000047 } from "./migrations/1706688000047-ConsolidatePlansToThreeTiers.js";
import { AddLogDeletionSafeguard1706688000048 } from "./migrations/1706688000048-AddLogDeletionSafeguard.js";
import { AddGithubRepoToKbCards1706688000049 } from "./migrations/1706688000049-AddGithubRepoToKbCards.js";
import { AddBoardIssueKeys1706688000050 } from "./migrations/1706688000050-AddBoardIssueKeys.js";
import { UpdateTeamCollaborationDirective1706688000051 } from "./migrations/1706688000051-UpdateTeamCollaborationDirective.js";
import { AddReviewingConsolidatingStatus1739750400000 } from "./migrations/1739750400000-AddReviewingConsolidatingStatus.js";
import { AddPlanningMode1739750400001 } from "./migrations/1739750400001-AddPlanningMode.js";
import { HashOrgApiKeys1739750400002 } from "./migrations/1739750400002-HashOrgApiKeys.js";
import { AddPrdDecomposition1739750400003 } from "./migrations/1739750400003-AddPrdDecomposition.js";
import { ConsolidatePersonas1739750400004 } from "./migrations/1739750400004-ConsolidatePersonas.js";
import { AddCardCreatedBy1739750400005 } from "./migrations/1739750400005-AddCardCreatedBy.js";
import { RenamePlansToProMaxEnterprise1739750400006 } from "./migrations/1739750400006-RenamePlansToProMaxEnterprise.js";
import { CreateStatusSnapshots1739750400007 } from "./migrations/1739750400007-CreateStatusSnapshots.js";
import { ChangeIssueTrackerDefaultToInternal1739750400008 } from "./migrations/1739750400008-ChangeIssueTrackerDefaultToInternal.js";
import { AddTrialExpiresAt1740200000000 } from "./migrations/1740200000000-AddTrialExpiresAt.js";
import { AddMfaBackupCodes1740200000001 } from "./migrations/1740200000001-AddMfaBackupCodes.js";
import { EncryptExistingTokens1740200000002 } from "./migrations/1740200000002-EncryptExistingTokens.js";
import { ChangeMaxPerStoryRevisionsDefault1740200000003 } from "./migrations/1740200000003-ChangeMaxPerStoryRevisionsDefault.js";
import { AddRemoteAgentGpuColumns1740200000004 } from "./migrations/1740200000004-AddRemoteAgentGpuColumns.js";
import { AddBoardExecutionId1740300000000 } from "./migrations/1740300000000-AddBoardExecutionId.js";
import { AddMarketingAgent1740400000000 } from "./migrations/1740400000000-AddMarketingAgent.js";
import { CreateOrgCredentials1740500000000 } from "./migrations/1740500000000-CreateOrgCredentials.js";
import { MigrateSecretsManagerToDb1740500000001 } from "./migrations/1740500000001-MigrateSecretsManagerToDb.js";
import { AddPollPerformanceIndexes1740600000000 } from "./migrations/1740600000000-AddPollPerformanceIndexes.js";
import { AddCoordinationAndStreamIndexes1740700000000 } from "./migrations/1740700000000-AddCoordinationAndStreamIndexes.js";
import { EnsureEnterpriseOrgAndPlatform1740800000000 } from "./migrations/1740800000000-EnsureEnterpriseOrgAndPlatform.js";
import { EncryptExistingApiKeys1740900000000 } from "./migrations/1740900000000-EncryptExistingApiKeys.js";
import { AddOrgAiGuidelines1741000000000 } from "./migrations/1741000000000-AddOrgAiGuidelines.js";
import { AddCloudComputeBilling1741100000000 } from "./migrations/1741100000000-AddCloudComputeBilling.js";
import { AddMaxTargetFiles1741200000000 } from "./migrations/1741200000000-AddMaxTargetFiles.js";
import { BlockOnTestFailuresDefault1741300000000 } from "./migrations/1741300000000-BlockOnTestFailuresDefault.js";
import { AddGithubAppInstallationId1741400000000 } from "./migrations/1741400000000-AddGithubAppInstallationId.js";
import { AddBoardMetadata1741500000000 } from "./migrations/1741500000000-AddBoardMetadata.js";
import { AddOrgQualityGateCommands1741600000000 } from "./migrations/1741600000000-AddOrgQualityGateCommands.js";
import { RemoveOrgQualityGateColumns1741700000000 } from "./migrations/1741700000000-RemoveOrgQualityGateColumns.js";
import { AddBoardEpicFields1741700000001 } from "./migrations/1741700000001-AddBoardEpicFields.js";
import { AddSpecEngineering1741800000000 } from "./migrations/1741800000000-AddSpecEngineering.js";
import { AddMaxCiFixRetries1741900000000 } from "./migrations/1741900000000-AddMaxCiFixRetries.js";
import { AddBlockerWaitTimeoutMinutes1742000000000 } from "./migrations/1742000000000-AddBlockerWaitTimeoutMinutes.js";
import { AddIntegrationCheckStatus1742100000000 } from "./migrations/1742100000000-AddIntegrationCheckStatus.js";
import { SplitPlanningMode1742200000000 } from "./migrations/1742200000000-SplitPlanningMode.js";
import { AddCriticApprovalThreshold1742300000000 } from "./migrations/1742300000000-AddCriticApprovalThreshold.js";
import { ConsolidateFixRetries1742400000000 } from "./migrations/1742400000000-ConsolidateFixRetries.js";
import { AddKbCardAttachments1742500000000 } from "./migrations/1742500000000-AddKbCardAttachments.js";
import { AddMaxAgentTurns1742600000000 } from "./migrations/1742600000000-AddMaxAgentTurns.js";
import { AddBlockOnLintErrors1742700000000 } from "./migrations/1742700000000-AddBlockOnLintErrors.js";
import { AddBlockOnE2EFailures1742800000000 } from "./migrations/1742800000000-AddBlockOnE2EFailures.js";
import { AddApiKeyPrefixToRemoteAgents1742900000000 } from "./migrations/1742900000000-AddApiKeyPrefixToRemoteAgents.js";
import { AddTicketKeyToKbCards1743000000000 } from "./migrations/1743000000000-AddTicketKeyToKbCards.js";
import { AddPushSubscriptions1741200000001 } from "./migrations/1741200000001-AddPushSubscriptions.js";
import { logger } from "../utils/logger.js";
import { OrganizationEncryptionSubscriber } from "./subscribers/OrganizationEncryptionSubscriber.js";
import { WebhookEndpointEncryptionSubscriber } from "./subscribers/WebhookEndpointEncryptionSubscriber.js";
import { OrgCredentialEncryptionSubscriber } from "./subscribers/OrgCredentialEncryptionSubscriber.js";

// When PGBOUNCER_HOST is set, connect to the sidecar instead of using DATABASE_URL directly.
// Must parse credentials from DATABASE_URL since TypeORM can't mix url with host/port overrides.
const dbConnectionOptions: Record<string, unknown> = process.env.PGBOUNCER_HOST && config.database.url
  ? (() => {
      const parsed = new URL(config.database.url);
      return {
        host: process.env.PGBOUNCER_HOST,
        port: parseInt(process.env.PGBOUNCER_PORT || "5432", 10),
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, ""),
      };
    })()
  : config.database.url
    ? { url: config.database.url }
    : {
        host: config.database.host,
        port: config.database.port,
        username: config.database.username,
        password: config.database.password,
        database: config.database.name,
      };

export const AppDataSource = new DataSource({
  type: "postgres",
  ...dbConnectionOptions,
  extra: {
    max: parseInt(process.env.DB_POOL_MAX || "10", 10),
    min: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    // PgBouncer transaction pooling requires disabling prepared statements
    ...(process.env.PGBOUNCER_HOST ? { prepareStatements: false } : {}),
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
    KbCardDependency,
    KbComment,
    KbChecklist,
    KbActivity,
    KbStarredBoard,
    MarketingCampaign,
    MarketingContent,
    MarketingAction,
    OrgCredential,
    KbSpec,
    KbSpecTemplate,
    KbSpecVersion,
    KbCardAttachment,
    PushSubscription,
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
    AddMultiOrgSupport1705344000055,
    SeedSystemPersonas1705344000056,
    AddEpicExecutionFields1705344000057,
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
    SetSupportAdminForUser1705344000121,
    DiagnoseUser1705344000122,
    DiagnoseOrg1705344000123,
    AddUserToOrg1705344000124,
    DiagnoseOtherInvites1705344000125,
    MigrateEnterpriseUsers1705344000126,
    MoveUsersToOrg1705344000127,
    CleanupStaleInvites1705344000128,
    RenameOrgToEnterprise1705344000129,
    AddPlatformOrgFlag1705344000200,
    AddBillingOrgId1705344000201,
    CreatePlatformOrg1705344000202,
    FixPlatformOrgUuid1705344000203,
    FixAuditLogsColumns1706688000000,
    AddIssueTrackerProvider1706688000001,
    DeleteTestInvite1706688000002,
    SyncUserOrgIdWithDefault1706688000003,
    ConfigurePlatformOrgSettings1706688000004,
    FixEnterpriseUsersAndCleanupOrgs1706688000005,
    CleanupTestUser1706688000006,
    DeleteTestUsers1706688000007,
    DeleteTestUsersAgain1706688000008,
    DeleteUserForInviteTest1706688000009,
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
    ChangeSelfReviewDefaultToFalse1706688000046,
    ConsolidatePlansToThreeTiers1706688000047,
    AddLogDeletionSafeguard1706688000048,
    AddGithubRepoToKbCards1706688000049,
    AddBoardIssueKeys1706688000050,
    UpdateTeamCollaborationDirective1706688000051,
    AddReviewingConsolidatingStatus1739750400000,
    AddPlanningMode1739750400001,
    HashOrgApiKeys1739750400002,
    AddPrdDecomposition1739750400003,
    ConsolidatePersonas1739750400004,
    AddCardCreatedBy1739750400005,
    RenamePlansToProMaxEnterprise1739750400006,
    CreateStatusSnapshots1739750400007,
    ChangeIssueTrackerDefaultToInternal1739750400008,
    AddTrialExpiresAt1740200000000,
    AddMfaBackupCodes1740200000001,
    EncryptExistingTokens1740200000002,
    ChangeMaxPerStoryRevisionsDefault1740200000003,
    AddRemoteAgentGpuColumns1740200000004,
    AddBoardExecutionId1740300000000,
    AddMarketingAgent1740400000000,
    CreateOrgCredentials1740500000000,
    MigrateSecretsManagerToDb1740500000001,
    AddPollPerformanceIndexes1740600000000,
    AddCoordinationAndStreamIndexes1740700000000,
    EnsureEnterpriseOrgAndPlatform1740800000000,
    EncryptExistingApiKeys1740900000000,
    AddOrgAiGuidelines1741000000000,
    AddCloudComputeBilling1741100000000,
    AddPushSubscriptions1741200000001,
    AddMaxTargetFiles1741200000000,
    BlockOnTestFailuresDefault1741300000000,
    AddGithubAppInstallationId1741400000000,
    AddBoardMetadata1741500000000,
    AddOrgQualityGateCommands1741600000000,
    RemoveOrgQualityGateColumns1741700000000,
    AddBoardEpicFields1741700000001,
    AddSpecEngineering1741800000000,
    AddMaxCiFixRetries1741900000000,
    AddBlockerWaitTimeoutMinutes1742000000000,
    AddIntegrationCheckStatus1742100000000,
    SplitPlanningMode1742200000000,
    AddCriticApprovalThreshold1742300000000,
    ConsolidateFixRetries1742400000000,
    AddKbCardAttachments1742500000000,
    AddMaxAgentTurns1742600000000,
    AddBlockOnLintErrors1742700000000,
    AddBlockOnE2EFailures1742800000000,
    AddApiKeyPrefixToRemoteAgents1742900000000,
    AddTicketKeyToKbCards1743000000000,
  ],
  subscribers: [
    OrganizationEncryptionSubscriber,
    WebhookEndpointEncryptionSubscriber,
    OrgCredentialEncryptionSubscriber,
  ],
  synchronize: false, // Use migrations in production
  logging: config.nodeEnv === "development",
  // Enable SSL for RDS connections (direct or via bastion tunnel)
  // - Direct RDS: URL contains rds.amazonaws.com
  // - Via tunnel: URL contains sslmode=require
  // - PgBouncer sidecar (PGBOUNCER_HOST): NO SSL — PgBouncer handles the RDS SSL
  ssl:
    process.env.PGBOUNCER_HOST
      ? false
      : config.database.url?.includes("rds.amazonaws.com") ||
          config.database.url?.includes("sslmode=require")
        ? {
            rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
            ...(fs.existsSync("/app/rds-combined-ca-bundle.pem")
              ? { ca: [fs.readFileSync("/app/rds-combined-ca-bundle.pem", "utf8")] }
              : {}),
          }
        : false,
});

/** Interval handle for pool monitoring — cleared on shutdown. */
let poolMonitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Log a warning when the connection pool is over 80% utilized.
 * Uses the underlying pg Pool stats (totalCount, idleCount, waitingCount).
 */
function startPoolMonitor(): void {
  const POOL_MAX = parseInt(process.env.DB_POOL_MAX || "10", 10);
  const WARN_THRESHOLD = 0.8; // 80%
  const CHECK_INTERVAL_MS = 30_000; // every 30s

  poolMonitorInterval = setInterval(() => {
    try {
      // TypeORM exposes the pg Pool via driver.master
      const pool = (AppDataSource.driver as any).master;
      if (!pool) return;

      const total: number = pool.totalCount ?? 0;
      const idle: number = pool.idleCount ?? 0;
      const waiting: number = pool.waitingCount ?? 0;
      const active = total - idle;
      const utilization = total > 0 ? active / POOL_MAX : 0;

      if (utilization >= WARN_THRESHOLD || waiting > 0) {
        logger.warn("DB connection pool utilization high", {
          active,
          idle,
          total,
          waiting,
          poolMax: POOL_MAX,
          utilizationPct: Math.round(utilization * 100),
        });
      }
    } catch {
      // Best-effort monitoring — never crash the app
    }
  }, CHECK_INTERVAL_MS);
}

export function stopPoolMonitor(): void {
  if (poolMonitorInterval) {
    clearInterval(poolMonitorInterval);
    poolMonitorInterval = null;
  }
}

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

    // Start periodic pool utilization monitoring
    startPoolMonitor();

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
