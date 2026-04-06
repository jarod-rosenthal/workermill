export interface ProgramEpic {
  title: string;
  issueKeys: string[];
}

function extractIssueNumbers(line: string): number[] {
  const nums = new Set<number>();

  for (const m of line.matchAll(/(^|[\s(])#(\d+)\b/g)) {
    nums.add(Number(m[2]));
  }
  for (const m of line.matchAll(/\bGH[-#]?(\d+)\b/gi)) {
    nums.add(Number(m[1]));
  }

  return [...nums].filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Parse a parent issue body into epic groups with ordered child issue keys.
 *
 * Rules:
 * - Any markdown heading starts a new epic section.
 * - Child issue refs are detected from `#123` or `GH-123` style tokens.
 * - Issue order is preserved by first appearance.
 * - Duplicate issue refs are de-duped globally.
 */
export function parseProgramEpicsFromIssueBody(body: string): ProgramEpic[] {
  const lines = (body || "").split("\n");
  const epics: ProgramEpic[] = [];
  const seenGlobal = new Set<string>();

  let currentTitle = "Epic 1";
  let currentIssues: string[] = [];

  const flushCurrent = () => {
    if (currentIssues.length === 0) return;
    epics.push({ title: currentTitle, issueKeys: currentIssues });
    currentIssues = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flushCurrent();
      currentTitle = heading[1].trim() || `Epic ${epics.length + 1}`;
      continue;
    }

    const nums = extractIssueNumbers(line);
    for (const n of nums) {
      const key = `#${n}`;
      if (seenGlobal.has(key)) continue;
      seenGlobal.add(key);
      currentIssues.push(key);
    }
  }

  flushCurrent();
  return epics;
}

