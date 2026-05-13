// CHANGELOG.md parser. The file is the source of truth; the admin page
// renders parsed versions. The midnight cron appends new sections.
//
// Format expected (markdown):
//   # tfila.co — Changelog
//
//   ## v1 — 2026-05-13
//
//   <prose paragraph>
//
//   ### Features
//   - item
//   - item
//
//   ### Functions / pipeline
//   - item
//
//   ### Stack & code notes
//   - item
//
//   ## v2 — 2026-05-14
//   ...

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ChangelogSection {
  heading: string;
  /** Each bullet is the raw markdown text with the leading "- " stripped. */
  bullets: string[];
}

export interface ChangelogVersion {
  /** "v1" / "v2" etc. */
  version: string;
  /** "2026-05-13" or whatever the date string is on the heading. */
  date: string | null;
  /** Free-text paragraph(s) before the first ### section (intro). */
  intro: string;
  sections: ChangelogSection[];
  /** Raw markdown of this version block, for fallback rendering. */
  raw: string;
}

const CHANGELOG_PATH = path.join(process.cwd(), "CHANGELOG.md");

export async function loadChangelog(): Promise<{
  versions: ChangelogVersion[];
  /** Raw content of the file's preamble (everything before v1). */
  preamble: string;
}> {
  let raw: string;
  try {
    raw = await readFile(CHANGELOG_PATH, "utf8");
  } catch (err) {
    // File missing → return empty
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { versions: [], preamble: "" };
    }
    throw err;
  }
  return parseChangelog(raw);
}

/**
 * Parse a CHANGELOG.md string into structured versions.
 *
 * Split rules:
 * - File starts with a preamble (the `# tfila.co — Changelog` header + intro)
 * - Each `## v{N} — <date>` starts a new version
 * - Within a version, `### {Heading}` starts a section
 * - Bullet lines (`- ...` / `* ...`) are pulled out of each section
 */
export function parseChangelog(md: string): {
  versions: ChangelogVersion[];
  preamble: string;
} {
  const lines = md.split("\n");
  const versions: ChangelogVersion[] = [];
  let preamble = "";
  let preambleDone = false;

  let cur: ChangelogVersion | null = null;
  let curSection: ChangelogSection | null = null;
  // Raw block being built for the current version (for fallback rendering).
  let curRawLines: string[] = [];

  function flushSection() {
    if (cur && curSection) {
      cur.sections.push(curSection);
      curSection = null;
    }
  }
  function flushVersion() {
    if (cur) {
      flushSection();
      cur.raw = curRawLines.join("\n").trimEnd();
      cur.intro = cur.intro.trim();
      versions.push(cur);
      cur = null;
      curRawLines = [];
    }
  }

  for (const line of lines) {
    // Detect version header: "## v1 — 2026-05-13" or "## v1 - 2026-05-13"
    const versionMatch = line.match(/^##\s+v(\d+)\s*[—-]\s*(.+?)\s*$/i);
    if (versionMatch) {
      flushVersion();
      preambleDone = true;
      cur = {
        version: `v${versionMatch[1]}`,
        date: versionMatch[2] || null,
        intro: "",
        sections: [],
        raw: "",
      };
      curRawLines = [line];
      continue;
    }

    // Detect section header: "### Features" / "### Stack & code notes"
    const sectionMatch = line.match(/^###\s+(.+?)\s*$/);
    if (sectionMatch && cur) {
      flushSection();
      curSection = { heading: sectionMatch[1].trim(), bullets: [] };
      curRawLines.push(line);
      continue;
    }

    // Detect bullet inside a section
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch && curSection) {
      curSection.bullets.push(bulletMatch[1].trim());
      curRawLines.push(line);
      continue;
    }

    if (cur) {
      // Inside a version but not a section bullet — either intro prose
      // or a continuation line.
      if (curSection) {
        // Continuation of last bullet (e.g. wrapped indented line)
        if (curSection.bullets.length > 0 && /^\s+\S/.test(line)) {
          curSection.bullets[curSection.bullets.length - 1] += "\n" + line.trim();
        }
      } else if (line.trim().length > 0 && !line.startsWith("---")) {
        cur.intro += line + "\n";
      }
      curRawLines.push(line);
    } else if (!preambleDone) {
      preamble += line + "\n";
    }
  }

  flushVersion();

  return { versions, preamble: preamble.trim() };
}

/** Pretty-render bullet text with simple inline markdown (bold, code, links). */
export function renderInlineMarkdown(text: string): string {
  // Returned for unit-testable preview. Real rendering is in the React
  // component (JSX) — see app/admin/changelog/page.tsx.
  return text;
}
