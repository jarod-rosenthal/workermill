/**
 * WorkerMill Persona Studio Service
 *
 * Manages personas, directives, and scripts with versioning support.
 * Handles CRUD operations, version history, and rollback functionality.
 */

import { AppDataSource } from "../db/connection.js";
import { IsNull, Not } from "typeorm";
import {
  Persona,
  PersonaDirective,
  PersonaScript,
  type DirectiveType,
} from "../models/index.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// Types
// ============================================================================

export interface CreatePersonaInput {
  slug: string;
  name: string;
  emoji?: string | null;
  color?: string | null;
  shortLabel?: string | null;
  description?: string | null;
  enabled?: boolean;
  priority?: number;
  skills?: string[] | null;
  riskLevel?: "low" | "medium" | "high";
}

export interface UpdatePersonaInput {
  name?: string;
  emoji?: string | null;
  color?: string | null;
  shortLabel?: string | null;
  description?: string | null;
  enabled?: boolean;
  priority?: number;
  skills?: string[] | null;
  riskLevel?: "low" | "medium" | "high";
}

export interface CreateDirectiveInput {
  type: DirectiveType;
  filename?: string | null;
  content: string;
  changeSummary?: string | null;
}

export interface CreateScriptInput {
  category: string;
  name: string;
  content: string;
  changeSummary?: string | null;
}

/**
 * Directive metadata for tracking purposes
 */
export interface DirectiveMetadata {
  id: string;
  version: number;
}

export interface PersonaBundle {
  persona: {
    id: string;
    slug: string;
    name: string;
    emoji: string | null;
    color: string | null;
    description: string | null;
  };
  directives: {
    readme: string | null;
    readmeMeta: DirectiveMetadata | null;
    common: Record<string, string>;
    commonMeta: Record<string, DirectiveMetadata>;
  };
  scripts: Record<string, string>;
}

// ============================================================================
// Persona CRUD
// ============================================================================

/**
 * Get all personas (system + org-specific)
 * Excludes the __common__ pseudo-persona used internally for shared directives
 */
export async function listPersonas(orgId: string | null): Promise<Persona[]> {
  const personaRepo = AppDataSource.getRepository(Persona);

  // Get system personas (orgId = null) and org-specific personas
  const personas = await personaRepo.find({
    where: [
      { orgId: IsNull() }, // System personas
      ...(orgId ? [{ orgId }] : []), // Org-specific personas
    ],
    order: { priority: "ASC", name: "ASC" },
  });

  // Filter out the __common__ pseudo-persona (used internally for shared directives)
  return personas.filter((p) => p.slug !== "__common__");
}

/**
 * Get a persona by ID with active directives and scripts
 */
export async function getPersonaById(
  id: string,
  orgId: string | null
): Promise<Persona | null> {
  const personaRepo = AppDataSource.getRepository(Persona);

  const persona = await personaRepo.findOne({
    where: { id },
    relations: ["directives", "scripts"],
  });

  if (!persona) return null;

  // Check access - must be system or same org
  if (persona.orgId !== null && persona.orgId !== orgId) {
    return null;
  }

  // Filter to only active directives and scripts
  persona.directives = persona.directives.filter((d) => d.isActive);
  persona.scripts = persona.scripts.filter((s) => s.isActive);

  return persona;
}

/**
 * Get a persona by slug
 */
export async function getPersonaBySlug(
  slug: string,
  orgId: string | null
): Promise<Persona | null> {
  const personaRepo = AppDataSource.getRepository(Persona);

  // First try to find org-specific override
  if (orgId) {
    const orgPersona = await personaRepo.findOne({
      where: { slug, orgId },
    });
    if (orgPersona) return orgPersona;
  }

  // Fall back to system persona
  const systemPersona = await personaRepo.findOne({
    where: { slug, orgId: IsNull() },
  });

  return systemPersona;
}

/**
 * Create a new persona
 */
export async function createPersona(
  orgId: string,
  input: CreatePersonaInput
): Promise<Persona> {
  const personaRepo = AppDataSource.getRepository(Persona);

  // Check if slug already exists for this org
  const existing = await personaRepo.findOne({
    where: { slug: input.slug, orgId },
  });

  if (existing) {
    throw new Error(`Persona with slug "${input.slug}" already exists`);
  }

  const persona = personaRepo.create({
    orgId,
    slug: input.slug,
    name: input.name,
    emoji: input.emoji || null,
    color: input.color || null,
    shortLabel: input.shortLabel || null,
    description: input.description || null,
    enabled: input.enabled ?? true,
    isSystem: false, // User-created personas are never system
    priority: input.priority ?? 0,
    skills: input.skills || null,
    riskLevel: input.riskLevel || "medium",
  });

  await personaRepo.save(persona);

  logger.info("Persona created", { personaId: persona.id, slug: persona.slug, orgId });

  return persona;
}

/**
 * Update a persona's metadata
 */
export async function updatePersona(
  id: string,
  orgId: string,
  input: UpdatePersonaInput
): Promise<Persona> {
  const personaRepo = AppDataSource.getRepository(Persona);

  const persona = await personaRepo.findOne({ where: { id } });

  if (!persona) {
    throw new Error("Persona not found");
  }

  // Check if user can edit this persona
  if (!persona.canEdit(orgId)) {
    throw new Error("Cannot edit system personas");
  }

  // Update fields
  if (input.name !== undefined) persona.name = input.name;
  if (input.emoji !== undefined) persona.emoji = input.emoji;
  if (input.color !== undefined) persona.color = input.color;
  if (input.shortLabel !== undefined) persona.shortLabel = input.shortLabel;
  if (input.description !== undefined) persona.description = input.description;
  if (input.enabled !== undefined) persona.enabled = input.enabled;
  if (input.priority !== undefined) persona.priority = input.priority;
  if (input.skills !== undefined) persona.skills = input.skills;
  if (input.riskLevel !== undefined) persona.riskLevel = input.riskLevel;

  await personaRepo.save(persona);

  logger.info("Persona updated", { personaId: persona.id, slug: persona.slug });

  return persona;
}

/**
 * Delete a persona (not allowed for system personas)
 */
export async function deletePersona(id: string, orgId: string): Promise<void> {
  const personaRepo = AppDataSource.getRepository(Persona);

  const persona = await personaRepo.findOne({ where: { id } });

  if (!persona) {
    throw new Error("Persona not found");
  }

  if (!persona.canDelete()) {
    throw new Error("Cannot delete system personas");
  }

  if (persona.orgId !== orgId) {
    throw new Error("Cannot delete personas from other organizations");
  }

  await personaRepo.remove(persona);

  logger.info("Persona deleted", { personaId: id, slug: persona.slug });
}

// ============================================================================
// Directive CRUD with Versioning
// ============================================================================

/**
 * Get active directives for a persona
 */
export async function listDirectives(personaId: string): Promise<PersonaDirective[]> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  return directiveRepo.find({
    where: { personaId, isActive: true },
    order: { type: "ASC", filename: "ASC" },
  });
}

/**
 * Get version history for a directive
 */
export async function getDirectiveHistory(
  personaId: string,
  type: DirectiveType,
  filename: string | null
): Promise<PersonaDirective[]> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const where: Record<string, unknown> = { personaId, type };
  if (filename) {
    where.filename = filename;
  } else {
    where.filename = IsNull();
  }

  return directiveRepo.find({
    where,
    order: { version: "DESC" },
    relations: ["createdBy"],
  });
}

/**
 * Create a new directive version (deactivates previous versions)
 */
export async function createDirectiveVersion(
  personaId: string,
  userId: string | null,
  input: CreateDirectiveInput
): Promise<PersonaDirective> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  // Get the current max version
  const existingDirectives = await directiveRepo.find({
    where: {
      personaId,
      type: input.type,
      filename: input.filename || IsNull(),
    },
    order: { version: "DESC" },
    take: 1,
  });

  const nextVersion = existingDirectives.length > 0 ? existingDirectives[0].version + 1 : 1;

  // Deactivate all previous versions
  await directiveRepo.update(
    {
      personaId,
      type: input.type,
      filename: input.filename || IsNull(),
    },
    { isActive: false }
  );

  // Create new version
  const directive = directiveRepo.create({
    personaId,
    type: input.type,
    filename: input.filename || null,
    content: input.content,
    version: nextVersion,
    isActive: true,
    createdById: userId,
    changeSummary: input.changeSummary || null,
  });

  await directiveRepo.save(directive);

  logger.info("Directive version created", {
    personaId,
    type: input.type,
    filename: input.filename,
    version: nextVersion,
  });

  return directive;
}

/**
 * Rollback to a previous directive version (creates new version with old content)
 */
export async function rollbackDirective(
  directiveId: string,
  userId: string | null
): Promise<PersonaDirective> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const targetDirective = await directiveRepo.findOne({ where: { id: directiveId } });

  if (!targetDirective) {
    throw new Error("Directive version not found");
  }

  // Create new version with content from target
  return createDirectiveVersion(targetDirective.personaId, userId, {
    type: targetDirective.type as DirectiveType,
    filename: targetDirective.filename,
    content: targetDirective.content,
    changeSummary: `Rollback to version ${targetDirective.version}`,
  });
}

/**
 * Delete all versions of a directive
 */
export async function deleteDirective(
  personaId: string,
  type: DirectiveType,
  filename: string | null
): Promise<void> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const where: Record<string, unknown> = { personaId, type };
  if (filename) {
    where.filename = filename;
  } else {
    where.filename = IsNull();
  }

  await directiveRepo.delete(where);

  logger.info("Directive deleted", { personaId, type, filename });
}

// ============================================================================
// Script CRUD with Versioning
// ============================================================================

/**
 * Get active scripts for a persona
 */
export async function listScripts(personaId: string): Promise<PersonaScript[]> {
  const scriptRepo = AppDataSource.getRepository(PersonaScript);

  return scriptRepo.find({
    where: { personaId, isActive: true },
    order: { category: "ASC", name: "ASC" },
  });
}

/**
 * Get version history for a script
 */
export async function getScriptHistory(
  personaId: string,
  category: string,
  name: string
): Promise<PersonaScript[]> {
  const scriptRepo = AppDataSource.getRepository(PersonaScript);

  return scriptRepo.find({
    where: { personaId, category, name },
    order: { version: "DESC" },
    relations: ["createdBy"],
  });
}

/**
 * Create a new script version (deactivates previous versions)
 */
export async function createScriptVersion(
  personaId: string,
  userId: string | null,
  input: CreateScriptInput
): Promise<PersonaScript> {
  const scriptRepo = AppDataSource.getRepository(PersonaScript);

  // Get the current max version
  const existingScripts = await scriptRepo.find({
    where: {
      personaId,
      category: input.category,
      name: input.name,
    },
    order: { version: "DESC" },
    take: 1,
  });

  const nextVersion = existingScripts.length > 0 ? existingScripts[0].version + 1 : 1;

  // Deactivate all previous versions
  await scriptRepo.update(
    {
      personaId,
      category: input.category,
      name: input.name,
    },
    { isActive: false }
  );

  // Create new version
  const script = scriptRepo.create({
    personaId,
    category: input.category,
    name: input.name,
    content: input.content,
    version: nextVersion,
    isActive: true,
    createdById: userId,
    changeSummary: input.changeSummary || null,
  });

  await scriptRepo.save(script);

  logger.info("Script version created", {
    personaId,
    category: input.category,
    name: input.name,
    version: nextVersion,
  });

  return script;
}

/**
 * Rollback to a previous script version (creates new version with old content)
 */
export async function rollbackScript(
  scriptId: string,
  userId: string | null
): Promise<PersonaScript> {
  const scriptRepo = AppDataSource.getRepository(PersonaScript);

  const targetScript = await scriptRepo.findOne({ where: { id: scriptId } });

  if (!targetScript) {
    throw new Error("Script version not found");
  }

  // Create new version with content from target
  return createScriptVersion(targetScript.personaId, userId, {
    category: targetScript.category,
    name: targetScript.name,
    content: targetScript.content,
    changeSummary: `Rollback to version ${targetScript.version}`,
  });
}

/**
 * Delete all versions of a script
 */
export async function deleteScript(
  personaId: string,
  category: string,
  name: string
): Promise<void> {
  const scriptRepo = AppDataSource.getRepository(PersonaScript);

  await scriptRepo.delete({ personaId, category, name });

  logger.info("Script deleted", { personaId, category, name });
}

// ============================================================================
// Worker Bundle API
// ============================================================================

/**
 * Get the complete bundle for a worker to use
 * Returns persona info, all active directives (including common), and all active scripts
 */
export async function getPersonaBundle(
  slug: string,
  orgId: string
): Promise<PersonaBundle | null> {
  const persona = await getPersonaBySlug(slug, orgId);

  if (!persona || !persona.enabled) {
    return null;
  }

  const directiveRepo = AppDataSource.getRepository(PersonaDirective);
  const scriptRepo = AppDataSource.getRepository(PersonaScript);

  // Get active directives for this persona
  const directives = await directiveRepo.find({
    where: { personaId: persona.id, isActive: true },
  });

  // Get active scripts for this persona
  const scripts = await scriptRepo.find({
    where: { personaId: persona.id, isActive: true },
  });

  // Get common directives (shared across all personas)
  const commonPersona = await getCommonPersona();
  const commonDirectives = await directiveRepo.find({
    where: { personaId: commonPersona.id, isActive: true },
  });

  // Build the bundle
  const bundle: PersonaBundle = {
    persona: {
      id: persona.id,
      slug: persona.slug,
      name: persona.name,
      emoji: persona.emoji,
      color: persona.color,
      description: persona.description,
    },
    directives: {
      readme: null,
      readmeMeta: null,
      common: {},
      commonMeta: {},
    },
    scripts: {},
  };

  // Populate persona-specific directives
  for (const directive of directives) {
    if (directive.type === "readme") {
      bundle.directives.readme = directive.content;
      bundle.directives.readmeMeta = {
        id: directive.id,
        version: directive.version,
      };
    } else if (directive.type === "common" && directive.filename) {
      bundle.directives.common[directive.filename] = directive.content;
      bundle.directives.commonMeta[directive.filename] = {
        id: directive.id,
        version: directive.version,
      };
    }
  }

  // Populate common directives (available to all personas)
  for (const directive of commonDirectives) {
    if (directive.type === "common" && directive.filename) {
      bundle.directives.common[directive.filename] = directive.content;
      bundle.directives.commonMeta[directive.filename] = {
        id: directive.id,
        version: directive.version,
      };
    }
  }

  // Populate scripts
  for (const script of scripts) {
    const key = `${script.category}/${script.name}`;
    bundle.scripts[key] = script.content;
  }

  return bundle;
}

// ============================================================================
// Common Directives (Special Persona)
// ============================================================================

const COMMON_PERSONA_SLUG = "__common__";

/**
 * Get or create the common directives pseudo-persona
 */
export async function getCommonPersona(): Promise<Persona> {
  const personaRepo = AppDataSource.getRepository(Persona);

  let common = await personaRepo.findOne({
    where: { slug: COMMON_PERSONA_SLUG, orgId: IsNull() },
  });

  if (!common) {
    common = personaRepo.create({
      orgId: null,
      slug: COMMON_PERSONA_SLUG,
      name: "Common Directives",
      description: "Shared directives available to all personas",
      isSystem: true,
      enabled: true,
      priority: -1,
    });
    await personaRepo.save(common);
  }

  return common;
}

/**
 * Get all common directives
 */
export async function listCommonDirectives(): Promise<PersonaDirective[]> {
  const common = await getCommonPersona();
  return listDirectives(common.id);
}

/**
 * Create/update a common directive
 */
export async function createCommonDirective(
  userId: string | null,
  filename: string,
  content: string,
  changeSummary?: string
): Promise<PersonaDirective> {
  const common = await getCommonPersona();

  return createDirectiveVersion(common.id, userId, {
    type: "common",
    filename,
    content,
    changeSummary,
  });
}

/**
 * Customize a system persona by creating an org-specific copy
 */
export async function customizePersona(
  personaId: string,
  orgId: string
): Promise<Persona> {
  const personaRepo = AppDataSource.getRepository(Persona);

  // Get the source persona
  const sourcePersona = await personaRepo.findOne({ where: { id: personaId } });
  if (!sourcePersona) {
    throw new Error("Persona not found");
  }

  // Check if it's a system persona
  if (!sourcePersona.isSystem) {
    throw new Error("Can only customize system personas");
  }

  // Check if org already has a customized version
  const existing = await personaRepo.findOne({
    where: { slug: sourcePersona.slug, orgId },
  });
  if (existing) {
    throw new Error("Organization already has a customized version of this persona");
  }

  // Create org-specific copy
  const customized = personaRepo.create({
    orgId,
    slug: sourcePersona.slug,
    name: sourcePersona.name,
    emoji: sourcePersona.emoji,
    color: sourcePersona.color,
    shortLabel: sourcePersona.shortLabel,
    description: sourcePersona.description,
    enabled: true,
    isSystem: false,
    priority: sourcePersona.priority,
    skills: sourcePersona.skills,
    riskLevel: sourcePersona.riskLevel,
  });

  await personaRepo.save(customized);
  return customized;
}

export interface SeedDirectiveInput {
  personaSlug: string;
  type: "readme" | "common";
  filename: string | null;
  content: string;
}

export interface SeedResult {
  seeded: number;
  skipped: number;
  errors: string[];
}

/**
 * Seed system persona directives from provided content
 */
export async function seedSystemDirectives(
  directives: SeedDirectiveInput[]
): Promise<SeedResult> {
  const personaRepo = AppDataSource.getRepository(Persona);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const result: SeedResult = { seeded: 0, skipped: 0, errors: [] };

  for (const input of directives) {
    try {
      let persona: Persona | null;

      // Handle __common__ persona specially
      if (input.personaSlug === COMMON_PERSONA_SLUG) {
        persona = await getCommonPersona();
      } else {
        // Find the system persona
        persona = await personaRepo.findOne({
          where: { slug: input.personaSlug, isSystem: true, orgId: IsNull() },
        });
      }

      if (!persona) {
        result.errors.push(`Persona not found: ${input.personaSlug}`);
        continue;
      }

      // Check if directive already exists
      const existing = await directiveRepo.findOne({
        where: {
          personaId: persona.id,
          type: input.type,
          filename: input.filename || IsNull(),
          isActive: true,
        },
      });

      if (existing) {
        // Update if content changed
        if (existing.content !== input.content) {
          await createDirectiveVersion(persona.id, null, {
            type: input.type,
            filename: input.filename,
            content: input.content,
            changeSummary: "System seed update",
          });
          result.seeded++;
        } else {
          result.skipped++;
        }
      } else {
        // Create new directive
        await createDirectiveVersion(persona.id, null, {
          type: input.type,
          filename: input.filename,
          content: input.content,
          changeSummary: "Initial system seed",
        });
        result.seeded++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Error seeding ${input.personaSlug}/${input.filename}: ${msg}`);
    }
  }

  return result;
}
