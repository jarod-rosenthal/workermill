#!/usr/bin/env npx tsx
/**
 * Diagnostic script to analyze a tenant's state
 * Usage: npx tsx scripts/diagnose-tenant.ts <org-name-or-slug>
 */

import "dotenv/config";
import { AppDataSource } from "../api/src/db/connection.js";
import { Organization, User, OrgInvite, UserOrganization } from "../api/src/models/index.js";
import {
  SecretsManagerClient,
  ListSecretsCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const SECRETS_PREFIX = process.env.SECRET_PREFIX || "workermill/dev";

async function main() {
  const orgIdentifier = process.argv[2];
  if (!orgIdentifier) {
    console.error("Usage: npx tsx scripts/diagnose-tenant.ts <org-name-or-slug>");
    process.exit(1);
  }

  console.log(`\n🔍 Diagnosing tenant: ${orgIdentifier}\n`);
  console.log("=".repeat(60));

  // Initialize database
  await AppDataSource.initialize();
  const orgRepo = AppDataSource.getRepository(Organization);
  const userRepo = AppDataSource.getRepository(User);
  const inviteRepo = AppDataSource.getRepository(OrgInvite);
  const userOrgRepo = AppDataSource.getRepository(UserOrganization);

  // Find organization
  const org = await orgRepo
    .createQueryBuilder("org")
    .where("LOWER(org.name) LIKE LOWER(:name)", { name: `%${orgIdentifier}%` })
    .orWhere("LOWER(org.slug) = LOWER(:slug)", { slug: orgIdentifier })
    .getOne();

  if (!org) {
    console.error(`❌ Organization not found: ${orgIdentifier}`);
    await AppDataSource.destroy();
    process.exit(1);
  }

  console.log("\n📋 ORGANIZATION DETAILS");
  console.log("-".repeat(60));
  console.log(`ID:        ${org.id}`);
  console.log(`Name:      ${org.name}`);
  console.log(`Slug:      ${org.slug || "(not set)"}`);
  console.log(`Created:   ${org.createdAt}`);
  console.log(`Plan:      ${org.plan || "free"}`);
  console.log(`SCM:       ${org.scmProvider || "github"}`);

  // List team members (using legacy orgId field)
  console.log("\n👥 TEAM MEMBERS (via user.orgId)");
  console.log("-".repeat(60));
  const members = await userRepo.find({
    where: { orgId: org.id },
    order: { createdAt: "ASC" },
  });

  if (members.length === 0) {
    console.log("⚠️  No members found via legacy orgId field");
  } else {
    for (const member of members) {
      console.log(
        `  • ${member.email} (${member.role}) - created ${member.createdAt.toISOString().split("T")[0]}`
      );
    }
  }

  // Check UserOrganization junction table
  console.log("\n👥 TEAM MEMBERS (via UserOrganization junction table)");
  console.log("-".repeat(60));
  const memberships = await userOrgRepo.find({
    where: { orgId: org.id },
    relations: ["user"],
    order: { joinedAt: "ASC" },
  });

  if (memberships.length === 0) {
    console.log("⚠️  No memberships in junction table");
    if (members.length > 0) {
      console.log("   This means multi-org features won't work correctly.");
      console.log("   Need to create UserOrganization records for existing members.");
    }
  } else {
    for (const m of memberships) {
      console.log(
        `  • ${m.user?.email || "(no user)"} (${m.role}) - joined ${m.joinedAt.toISOString().split("T")[0]}${m.isDefault ? " [default]" : ""}`
      );
    }
  }

  // List pending invites
  console.log("\n📨 PENDING INVITES");
  console.log("-".repeat(60));
  const invites = await inviteRepo.find({
    where: { orgId: org.id, accepted: false },
    order: { createdAt: "DESC" },
  });

  if (invites.length === 0) {
    console.log("✓ No pending invites");
  } else {
    for (const invite of invites) {
      const expired = invite.isExpired();
      const status = expired ? "❌ EXPIRED" : "⏳ PENDING";
      console.log(`  ${status} ${invite.email} (${invite.role})`);
      console.log(`         Token: ${invite.token.substring(0, 8)}...`);
      console.log(`         Created: ${invite.createdAt.toISOString()}`);
      console.log(`         Expires: ${invite.expiresAt.toISOString()}`);

      // Check if this user already exists
      const existingUser = await userRepo.findOne({
        where: { email: invite.email.toLowerCase() },
      });
      if (existingUser) {
        console.log(`         ⚠️  User already exists with orgId: ${existingUser.orgId}`);
        if (existingUser.orgId === org.id) {
          console.log("         🔧 FIX: This invite should be deleted - user is already a member");
        }
      }
    }
  }

  // Check AWS Secrets Manager
  console.log("\n🔐 INTEGRATION SECRETS (AWS Secrets Manager)");
  console.log("-".repeat(60));
  const secretsClient = new SecretsManagerClient({ region: "us-east-1" });
  const secretsPath = `${SECRETS_PREFIX}/orgs/${org.id}/`;

  try {
    const listResult = await secretsClient.send(
      new ListSecretsCommand({
        Filters: [{ Key: "name", Values: [secretsPath] }],
      })
    );

    const secrets = listResult.SecretList || [];
    if (secrets.length === 0) {
      console.log(`⚠️  No secrets found at path: ${secretsPath}`);
      console.log("   This means NO integrations are configured.");
    } else {
      console.log(`Found ${secrets.length} secret(s):`);
      for (const secret of secrets) {
        const name = secret.Name?.replace(secretsPath, "") || "unknown";
        console.log(`  ✓ ${name}`);

        // Peek at non-sensitive metadata
        try {
          const valueResult = await secretsClient.send(
            new GetSecretValueCommand({ SecretId: secret.Name })
          );
          if (valueResult.SecretString) {
            const parsed = JSON.parse(valueResult.SecretString);
            if (name === "jira-credentials") {
              console.log(`      base_url: ${parsed.base_url || parsed.baseUrl || "not set"}`);
              console.log(`      email: ${parsed.email || "not set"}`);
            } else if (name === "github-token") {
              console.log(`      token: ${"*".repeat(8)} (configured)`);
            }
          }
        } catch {
          // Can't read secret value - that's OK
        }
      }
    }
  } catch (error) {
    console.log(`❌ Error accessing Secrets Manager: ${error}`);
  }

  // Organization key settings
  console.log("\n⚙️  KEY SETTINGS");
  console.log("-".repeat(60));
  console.log(`Primary Provider:    ${org.primaryProvider || "anthropic"}`);
  console.log(`Default Model:       ${org.defaultWorkerModel || "claude-haiku-4-5-20251001"}`);
  console.log(`Max Concurrent:      ${org.maxConcurrentWorkers || 3}`);
  console.log(`Webhook Secrets:`);
  console.log(`  Jira:     ${org.jiraWebhookSecret ? "✓ configured" : "✗ not set"}`);
  console.log(`  GitHub:   ${org.githubWebhookSecret ? "✓ configured" : "✗ not set"}`);
  console.log(`  GitLab:   ${org.gitlabWebhookSecret ? "✓ configured" : "✗ not set"}`);

  // Recommendations
  console.log("\n💡 RECOMMENDATIONS");
  console.log("-".repeat(60));

  const issues: string[] = [];

  // Check for orphaned invites
  for (const invite of invites) {
    const existingUser = await userRepo.findOne({
      where: { email: invite.email.toLowerCase() },
    });
    if (existingUser && existingUser.orgId === org.id) {
      issues.push(
        `DELETE FROM org_invites WHERE id = '${invite.id}'; -- User ${invite.email} already a member`
      );
    }
  }

  // Check for missing UserOrganization records
  for (const member of members) {
    const hasJunction = memberships.some((m) => m.userId === member.id);
    if (!hasJunction) {
      issues.push(
        `INSERT INTO user_organizations (id, user_id, org_id, role, is_default) VALUES (gen_random_uuid(), '${member.id}', '${org.id}', '${member.role || "member"}', true); -- Fix ${member.email}`
      );
    }
  }

  if (issues.length === 0) {
    console.log("✓ No issues found requiring manual fixes");
  } else {
    console.log("Run these SQL commands to fix issues:\n");
    for (const sql of issues) {
      console.log(sql);
    }
  }

  console.log("\n" + "=".repeat(60));
  await AppDataSource.destroy();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
