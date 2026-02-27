import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";
import type { QualityFeedback } from "../models/KbSpec.js";

const SCORING_RUBRIC = `You are a specification quality evaluator for AI coding agents. Score the following specification on 5 dimensions.

***REMOVED******REMOVED*** Scoring Dimensions (total = 100 weighted)

***REMOVED******REMOVED******REMOVED*** Completeness (weight: 30%)
Does the spec include these sections?
- Overview/deliverables
- Technical specification with version constraints
- Data model (database schema)
- Architecture (file structure, patterns)
- API specification (endpoints)
- Component specification (UI)
- Quality gates (lint, test, typecheck commands)
- Acceptance criteria
- Scope boundary ("DO NOT" section)
Score 0-100 based on coverage. Missing critical sections (scope boundary, version constraints) penalize heavily.

***REMOVED******REMOVED******REMOVED*** Clarity (weight: 20%)
- Are requirements testable and unambiguous?
- No vague language ("should be fast", "nice UI", "good UX")
- Specific values instead of qualitative descriptions
- Clear input/output expectations
Score 0-100.

***REMOVED******REMOVED******REMOVED*** Decomposability (weight: 20%)
- Can this be broken into independent stories?
- Are dependencies between components explicit?
- Are stories small enough for a single worker?
- Is execution order clear?
Score 0-100.

***REMOVED******REMOVED******REMOVED*** Constraints (weight: 15%)
- Are dependency versions pinned (exact or semver range)?
- Is the tech stack specific (not "a modern framework")?
- Are "DO NOT" sections present and specific?
- Are scope boundaries clear?
Score 0-100.

***REMOVED******REMOVED******REMOVED*** Testability (weight: 15%)
- Are acceptance criteria measurable (not subjective)?
- Are quality gate commands specified?
- Are test expectations concrete?
- Can a machine verify success?
Score 0-100.

***REMOVED******REMOVED*** Response Format

Return ONLY valid JSON matching this schema:
{
  "overall": <weighted score 0-100>,
  "dimensions": {
    "completeness": { "score": <0-100>, "feedback": "<specific feedback>" },
    "clarity": { "score": <0-100>, "feedback": "<specific feedback>" },
    "decomposability": { "score": <0-100>, "feedback": "<specific feedback>" },
    "constraints": { "score": <0-100>, "feedback": "<specific feedback>" },
    "testability": { "score": <0-100>, "feedback": "<specific feedback>" }
  },
  "suggestions": [
    "<actionable suggestion 1>",
    "<actionable suggestion 2>",
    "<actionable suggestion 3>"
  ]
}

Return 3-5 suggestions, ordered by impact. Each suggestion must be actionable (tell the user exactly what to add or change).`;

export async function scoreSpec(
  specContent: string,
  orgRequiredSections?: string[] | null,
): Promise<QualityFeedback> {
  const anthropic = new Anthropic();

  let systemPrompt = SCORING_RUBRIC;
  if (orgRequiredSections?.length) {
    systemPrompt += `\n\n***REMOVED******REMOVED*** Organization Required Sections\nThis organization requires these additional sections: ${orgRequiredSections.join(", ")}. Penalize completeness if missing.`;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Score this specification:\n\n${specContent}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error("Failed to parse scoring response", { text });
    throw new Error("Failed to parse quality score response");
  }

  const feedback = JSON.parse(jsonMatch[0]) as QualityFeedback;

  // Validate the weighted overall score
  const d = feedback.dimensions;
  const expectedOverall = Math.round(
    d.completeness.score * 0.3 +
      d.clarity.score * 0.2 +
      d.decomposability.score * 0.2 +
      d.constraints.score * 0.15 +
      d.testability.score * 0.15,
  );
  // Use the LLM's overall if close, recalculate if off by more than 5
  if (Math.abs(feedback.overall - expectedOverall) > 5) {
    feedback.overall = expectedOverall;
  }

  return feedback;
}
