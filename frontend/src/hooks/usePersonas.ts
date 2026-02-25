import { useState, useEffect } from "react";
import apiClient from "../lib/api-client";

interface PersonaMeta {
  slug: string;
  name: string;
  emoji: string | null;
  color: string | null;
  shortLabel: string | null;
}

// Hardcoded fallbacks for offline/loading state
const FALLBACK_PERSONAS: Record<string, PersonaMeta> = {
  frontend_developer: { slug: "frontend_developer", name: "Frontend Developer", emoji: "\u{1F3A8}", color: "***REMOVED***8B5CF6", shortLabel: "Frontend" },
  backend_developer: { slug: "backend_developer", name: "Backend Developer", emoji: "\u2699\uFE0F", color: "***REMOVED***3B82F6", shortLabel: "Backend" },
  devops_engineer: { slug: "devops_engineer", name: "DevOps Engineer", emoji: "\u{1F527}", color: "***REMOVED***F59E0B", shortLabel: "DevOps" },
  security_engineer: { slug: "security_engineer", name: "Security Engineer", emoji: "\u{1F512}", color: "***REMOVED***EF4444", shortLabel: "Security" },
  qa_engineer: { slug: "qa_engineer", name: "QA Engineer", emoji: "\u{1F9EA}", color: "***REMOVED***10B981", shortLabel: "QA" },
  tech_writer: { slug: "tech_writer", name: "Technical Writer", emoji: "\u{1F4DD}", color: "***REMOVED***6366F1", shortLabel: "Docs" },
  project_manager: { slug: "project_manager", name: "Project Manager", emoji: "\u{1F4CB}", color: "***REMOVED***EC4899", shortLabel: "PM" },
  architect: { slug: "architect", name: "Architect", emoji: "\u{1F3D7}\uFE0F", color: "***REMOVED***7C3AED", shortLabel: "Architect" },
  data_ml_engineer: { slug: "data_ml_engineer", name: "Data & ML Engineer", emoji: "\u{1F4CA}", color: "***REMOVED***14B8A6", shortLabel: "Data/ML" },
  mobile_developer: { slug: "mobile_developer", name: "Mobile Developer", emoji: "\u{1F4F1}", color: "***REMOVED***22C55E", shortLabel: "Mobile" },
  tech_lead: { slug: "tech_lead", name: "Tech Lead", emoji: "\u{1F468}\u200D\u{1F4BC}", color: "***REMOVED***7C3AED", shortLabel: "Lead" },
  manager: { slug: "manager", name: "Manager", emoji: "\u{1F454}", color: "***REMOVED***6B7280", shortLabel: "Manager" },
  support_agent: { slug: "support_agent", name: "Support Agent", emoji: "\u{1F4AC}", color: "***REMOVED***06B6D4", shortLabel: "Support" },
};

let cachedPersonas: Record<string, PersonaMeta> | null = null;

/**
 * Hook to fetch persona metadata from API with fallback to hardcoded defaults.
 */
export function usePersonas(): Record<string, PersonaMeta> {
  const [personas, setPersonas] = useState<Record<string, PersonaMeta>>(
    cachedPersonas || FALLBACK_PERSONAS,
  );

  useEffect(() => {
    if (cachedPersonas) return;

    apiClient
      .get("/personas")
      .then((res) => {
        const map: Record<string, PersonaMeta> = { ...FALLBACK_PERSONAS };
        for (const p of res.data.personas) {
          map[p.slug] = {
            slug: p.slug,
            name: p.name,
            emoji: p.emoji || FALLBACK_PERSONAS[p.slug]?.emoji || null,
            color: p.color || FALLBACK_PERSONAS[p.slug]?.color || null,
            shortLabel:
              p.shortLabel || FALLBACK_PERSONAS[p.slug]?.shortLabel || null,
          };
        }
        cachedPersonas = map;
        setPersonas(map);
      })
      .catch(() => {
        // Silently use fallbacks
      });
  }, []);

  return personas;
}

export function getPersonaEmoji(slug: string): string {
  return cachedPersonas?.[slug]?.emoji || FALLBACK_PERSONAS[slug]?.emoji || "";
}

export function getPersonaColor(slug: string): string {
  return (
    cachedPersonas?.[slug]?.color ||
    FALLBACK_PERSONAS[slug]?.color ||
    "***REMOVED***6B7280"
  );
}

export function getPersonaName(slug: string): string {
  return (
    cachedPersonas?.[slug]?.name ||
    FALLBACK_PERSONAS[slug]?.name ||
    slug.replace(/_/g, " ")
  );
}

export function getPersonaShortLabel(slug: string): string {
  return (
    cachedPersonas?.[slug]?.shortLabel ||
    FALLBACK_PERSONAS[slug]?.shortLabel ||
    slug.replace(/_/g, " ")
  );
}
