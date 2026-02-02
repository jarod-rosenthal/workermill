import { AppDataSource } from "../db/connection.js";
import { UserOrganization, type OrgMemberRole } from "../models/UserOrganization.js";
import { Organization } from "../models/Organization.js";
import { logger } from "../utils/logger.js";

/**
 * Get all organizations a user belongs to
 */
export async function getUserOrganizations(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    slug: string | null;
    role: OrgMemberRole;
    isDefault: boolean;
    joinedAt: Date;
  }>
> {
  const repo = AppDataSource.getRepository(UserOrganization);

  const memberships = await repo.find({
    where: { userId },
    relations: ["organization"],
    order: { isDefault: "DESC", joinedAt: "ASC" },
  });

  return memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
    isDefault: m.isDefault,
    joinedAt: m.joinedAt,
  }));
}

/**
 * Get the user's default organization
 */
export async function getDefaultOrganization(userId: string): Promise<Organization | null> {
  const result = await getDefaultOrganizationWithRole(userId);
  return result?.organization ?? null;
}

/**
 * Get the user's default organization AND their role in it
 * This is the primary function - use this to get both org and role in one query
 */
export async function getDefaultOrganizationWithRole(
  userId: string
): Promise<{ organization: Organization; role: OrgMemberRole } | null> {
  const repo = AppDataSource.getRepository(UserOrganization);

  // First try to find explicit default
  let membership = await repo.findOne({
    where: { userId, isDefault: true },
    relations: ["organization"],
  });

  // Fall back to most recently joined org if no explicit default
  if (!membership) {
    membership = await repo.findOne({
      where: { userId },
      relations: ["organization"],
      order: { joinedAt: "DESC" }, // Most recent org, not oldest
    });

    // Also set this as the explicit default to prevent future confusion
    if (membership) {
      membership.isDefault = true;
      await repo.save(membership);
    }
  }

  if (!membership) {
    return null;
  }

  return {
    organization: membership.organization,
    role: membership.role,
  };
}

/**
 * Set a user's default organization
 * Only updates user_organizations.is_default (single source of truth)
 */
export async function setDefaultOrganization(userId: string, orgId: string): Promise<void> {
  const repo = AppDataSource.getRepository(UserOrganization);

  // Verify user has access to this org
  const membership = await repo.findOne({
    where: { userId, orgId },
  });

  if (!membership) {
    throw new Error("User is not a member of this organization");
  }

  // Clear existing default in user_organizations
  await repo.update({ userId, isDefault: true }, { isDefault: false });

  // Set new default in user_organizations
  await repo.update({ userId, orgId }, { isDefault: true });

  logger.info("Updated user default organization", { userId, orgId });
}

/**
 * Add a user to an organization
 */
export async function addUserToOrganization(
  userId: string,
  orgId: string,
  role: OrgMemberRole = "member",
  invitedBy?: string,
  isDefault?: boolean
): Promise<UserOrganization> {
  const repo = AppDataSource.getRepository(UserOrganization);

  // Check if already a member
  const existing = await repo.findOne({ where: { userId, orgId } });
  if (existing) {
    throw new Error("User is already a member of this organization");
  }

  // If this will be their default, clear any existing default
  if (isDefault) {
    await repo.update({ userId, isDefault: true }, { isDefault: false });
  }

  // Check if this is their first org (make it default automatically)
  const existingMemberships = await repo.count({ where: { userId } });
  const shouldBeDefault = isDefault ?? existingMemberships === 0;

  const membership = repo.create({
    userId,
    orgId,
    role,
    invitedBy: invitedBy ?? null,
    isDefault: shouldBeDefault,
  });

  await repo.save(membership);

  logger.info("Added user to organization", { userId, orgId, role });

  return membership;
}

/**
 * Remove a user from an organization
 */
export async function removeUserFromOrganization(userId: string, orgId: string): Promise<void> {
  const repo = AppDataSource.getRepository(UserOrganization);

  const membership = await repo.findOne({ where: { userId, orgId } });
  if (!membership) {
    throw new Error("User is not a member of this organization");
  }

  // Prevent removing owner if they're the only owner
  if (membership.role === "owner") {
    const ownerCount = await repo.count({
      where: { orgId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new Error("Cannot remove the only owner of an organization");
    }
  }

  const wasDefault = membership.isDefault;
  await repo.remove(membership);

  // If this was their default, set a new default
  if (wasDefault) {
    const nextMembership = await repo.findOne({
      where: { userId },
      order: { joinedAt: "ASC" },
    });
    if (nextMembership) {
      await repo.update({ id: nextMembership.id }, { isDefault: true });
    }
  }

  logger.info("Removed user from organization", { userId, orgId });
}

/**
 * Update a user's role in an organization
 */
export async function updateUserRole(
  userId: string,
  orgId: string,
  newRole: OrgMemberRole
): Promise<void> {
  const repo = AppDataSource.getRepository(UserOrganization);

  const membership = await repo.findOne({ where: { userId, orgId } });
  if (!membership) {
    throw new Error("User is not a member of this organization");
  }

  // Prevent demoting the only owner
  if (membership.role === "owner" && newRole !== "owner") {
    const ownerCount = await repo.count({
      where: { orgId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new Error("Cannot demote the only owner of an organization");
    }
  }

  membership.role = newRole;
  await repo.save(membership);

  logger.info("Updated user role", { userId, orgId, newRole });
}

/**
 * Check if a user has access to an organization
 */
export async function hasOrgAccess(userId: string, orgId: string): Promise<boolean> {
  const repo = AppDataSource.getRepository(UserOrganization);
  const membership = await repo.findOne({ where: { userId, orgId } });
  return !!membership;
}

/**
 * Get user's role in an organization
 */
export async function getUserOrgRole(
  userId: string,
  orgId: string
): Promise<OrgMemberRole | null> {
  const repo = AppDataSource.getRepository(UserOrganization);

  const membership = await repo.findOne({ where: { userId, orgId } });
  return membership?.role ?? null;
}
