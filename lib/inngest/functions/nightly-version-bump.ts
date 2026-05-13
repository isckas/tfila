// Nightly cron — bumps the changelog to a new version at midnight ET.
//
// Reads the current CHANGELOG.md from GitHub, finds the latest `## v{N}`
// header, pulls every commit since that version's date, groups them by
// conventional-commit prefix, and appends a new `## v{N+1}` section.
// Commits the change back via the GitHub Contents API, which auto-deploys
// on Vercel.
//
// Skips entirely when:
//   - GITHUB_WRITE_TOKEN is unset (logs a warning once per cold start)
//   - No new commits since the last version (no-op, no spurious bumps)
//
// Schedule: `0 5 * * *` = 05:00 UTC = 00:00 EST / 01:00 EDT — close enough
// to "midnight ET" year-round without needing DST-aware logic.

import { inngest } from "../client";

const OWNER = "isckas";
const REPO = "tfila";
const BRANCH = "main";
const FILE_PATH = "CHANGELOG.md";

let warnedMissingToken = false;

export const nightlyVersionBump = inngest.createFunction(
  {
    id: "nightly-version-bump",
    triggers: [{ cron: "0 5 * * *" }],
  },
  async ({ step }) => {
    const token = process.env.GITHUB_WRITE_TOKEN;
    if (!token) {
      if (!warnedMissingToken) {
        warnedMissingToken = true;
        console.warn(
          "[nightly-version-bump] GITHUB_WRITE_TOKEN not set — cron will no-op until configured.",
        );
      }
      return { skipped: true, reason: "GITHUB_WRITE_TOKEN not set" };
    }

    // ─── 1. Read current CHANGELOG.md + its file SHA ───────────
    const fileInfo = await step.run("read-current-changelog", async () => {
      return githubGetFile(token, OWNER, REPO, FILE_PATH, BRANCH);
    });
    if (!fileInfo) {
      return { skipped: true, reason: "CHANGELOG.md not found in repo" };
    }

    const currentContent = Buffer.from(fileInfo.content, "base64").toString("utf8");
    const { latestVersion, latestDate } = parseLatestVersion(currentContent);

    // ─── 2. Gather commits since the latest version's date ─────
    const since = isoDayStartUtc(latestDate ?? todayIso());
    const commits = await step.run("fetch-commits", async () => {
      return githubListCommits(token, OWNER, REPO, BRANCH, since);
    });

    // Filter out the changelog-bump commit itself + merge commits if any.
    const newCommits = commits.filter(
      (c) => !/^v\d+:\s/.test(c.subject) && !c.subject.startsWith("Merge "),
    );

    if (newCommits.length === 0) {
      return {
        skipped: true,
        reason: "no new commits since last version",
        latestVersion,
      };
    }

    // ─── 3. Build the new section ──────────────────────────────
    const newVersion = nextVersion(latestVersion);
    const today = todayIso();
    const newSection = buildVersionSection(newVersion, today, newCommits);

    // ─── 4. Insert below the `---` separator that follows the preamble ──
    // CHANGELOG layout: <preamble>\n\n---\n\n## v1 — date ...
    // We insert the new section after the `---` and before the previous
    // `## v` so latest version ends up at top.
    const updatedContent = insertNewVersion(currentContent, newSection);

    // ─── 5. Commit via Contents API ────────────────────────────
    await step.run("push-changelog", async () => {
      return githubPutFile(
        token,
        OWNER,
        REPO,
        FILE_PATH,
        BRANCH,
        Buffer.from(updatedContent, "utf8").toString("base64"),
        fileInfo.sha,
        `${newVersion}: changelog bump — ${newCommits.length} commit${newCommits.length === 1 ? "" : "s"}`,
      );
    });

    return {
      bumped: true,
      newVersion,
      date: today,
      commitCount: newCommits.length,
    };
  },
);

// ─── Helpers ─────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDayStartUtc(dateIso: string): string {
  return `${dateIso}T00:00:00Z`;
}

function parseLatestVersion(md: string): {
  latestVersion: string | null;
  latestDate: string | null;
} {
  const m = md.match(/^##\s+v(\d+)\s*[—-]\s*(\S+)/m);
  if (!m) return { latestVersion: null, latestDate: null };
  return { latestVersion: `v${m[1]}`, latestDate: m[2] };
}

function nextVersion(latest: string | null): string {
  if (!latest) return "v1";
  const m = latest.match(/^v(\d+)$/);
  if (!m) return "v1";
  return `v${Number(m[1]) + 1}`;
}

interface CommitInfo {
  sha: string;
  subject: string;
  body: string;
}

function buildVersionSection(
  version: string,
  date: string,
  commits: CommitInfo[],
): string {
  const features: string[] = [];
  const fixes: string[] = [];
  const notes: string[] = [];

  for (const c of commits) {
    const lower = c.subject.toLowerCase();
    if (/^feat(\(|:)/.test(lower)) {
      features.push(stripPrefix(c.subject));
    } else if (/^fix(\(|:)/.test(lower)) {
      fixes.push(stripPrefix(c.subject));
    } else {
      notes.push(stripPrefix(c.subject));
    }
  }

  const lines: string[] = [];
  lines.push(`## ${version} — ${date}`);
  lines.push("");
  lines.push(
    `Automatic version bump. ${commits.length} commit${commits.length === 1 ? "" : "s"} since the previous version.`,
  );
  lines.push("");

  if (features.length > 0) {
    lines.push("### Features");
    for (const item of features) lines.push(`- ${item}`);
    lines.push("");
  }
  if (fixes.length > 0) {
    lines.push("### Fixes");
    for (const item of fixes) lines.push(`- ${item}`);
    lines.push("");
  }
  if (notes.length > 0) {
    lines.push("### Stack & code notes");
    for (const item of notes) lines.push(`- ${item}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function stripPrefix(subject: string): string {
  // "feat(cascade): foo" → "foo" (keep the scope visible if present, just drop the type prefix)
  return subject.replace(/^[a-z]+(\([^)]+\))?:\s*/i, "").trim();
}

function insertNewVersion(md: string, newSection: string): string {
  // Insert the new version directly above the first `## v` block.
  const idx = md.search(/^##\s+v\d+/m);
  if (idx === -1) {
    // No prior versions — append at end
    return md.trimEnd() + "\n\n" + newSection + "\n";
  }
  return (
    md.slice(0, idx).trimEnd() +
    "\n\n" +
    newSection +
    "\n\n" +
    md.slice(idx).trimStart()
  );
}

// ─── GitHub API thin wrappers ────────────────────────────────────────────

async function githubGetFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `GitHub get-file failed: HTTP ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const json = (await res.json()) as { content: string; sha: string };
  return { content: json.content, sha: json.sha };
}

async function githubListCommits(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sinceIso: string,
): Promise<CommitInfo[]> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
  url.searchParams.set("sha", branch);
  url.searchParams.set("since", sinceIso);
  url.searchParams.set("per_page", "100");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub list-commits failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as Array<{
    sha: string;
    commit: { message: string };
  }>;
  return json.map((c) => {
    const [subject, ...rest] = c.commit.message.split("\n\n");
    return {
      sha: c.sha,
      subject: subject.split("\n")[0].trim(),
      body: rest.join("\n\n").trim(),
    };
  });
}

async function githubPutFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  branch: string,
  contentBase64: string,
  sha: string,
  message: string,
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: contentBase64,
        sha,
        branch,
        committer: {
          name: "tfila-bot",
          email: "bot@tfila.co",
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `GitHub put-file failed: HTTP ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
}
