# Plan — `/save` + `/resume` skills (session continuity)

## Context

The user works across long multi-session arcs (the tfila.co build is one example — 16+ sessions over weeks). The risk is **project drift**: each new session starts fresh, and if nothing is persisted between sessions, context gets reconstructed by guesswork. Today's manual save (PROGRESS.md / SESSION.md / DECISIONS.md / MEMORY.md updates) is the right pattern but the user shouldn't have to remember the ritual every time.

Two skills will codify the ritual:

- **`/save`** — checkpoint current session state into existing docs
- **`/resume`** — read those docs + git + tasks and surface where you left off

Both go at user scope (`~/.claude/skills/<name>/SKILL.md`) so they work in every project. Per the locked answers: update existing docs (don't introduce a new SESSION-STATE.md type), pair `/save` with `/resume` (Option B), user-wide.

## Gaps found in v1 draft (research pass — 2026-05-18)

Searched best practices in three areas: Claude Code skill patterns, AI coding agent memory systems (Aider/Cline/agentmemory/mem0), and LLM context-compression handoff techniques. Compared findings to v1 draft. Twelve gaps identified, four of which are critical:

### Critical — incorporated into v2 design below

1. **No PreCompact hook for auto-save before context-window compression.** User's original ask was "when the rag window is compressed... nothing is lost." Claude Code fires a `PreCompact` lifecycle hook before auto-compaction. v1 was manual-only. v2 adds a hook that triggers `/save` automatically (with a "quick" mode) before the hard compression hits. Source: [LangChain context management for deep agents](https://blog.langchain.com/context-management-for-deepagents/).

2. **No handoff-summary framing.** Best practice is to frame each session checkpoint as a "briefing for the next LLM" — current progress, key decisions, important constraints, user preferences, remaining TODOs, critical data needed. v1's SESSION.md format covers most of this but implicitly. v2 makes it explicit with a `## Briefing for next session` first-section template. Source: [AI Agent Context Compression](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies).

3. **No goal-drift detection.** Critical failure mode in long agentic workflows: "2% misalignment → 40% failure rate" if drift compounds across sessions. v1 had no comparison step. v2's `/resume` now reads the PRIOR session's "next action" line and flags if the current conversation is heading somewhere different ("Last session targeted A, this session is exploring B — confirm?"). Source: [Active Context Compression paper](https://arxiv.org/pdf/2601.07190).

4. **No tasks carry-forward.** TaskCreate/Update state is session-scoped — it doesn't survive a new conversation. Best-practice handoff includes "remaining TODOs." v2's `/save` now snapshots all incomplete tasks (status: in_progress, pending) into a `## In-flight tasks` section in SESSION.md, with re-import instructions for `/resume` to recreate them via TaskCreate in the new session. Source: [Persistent Memory for AI Coding Agents](https://medium.com/@sourabh.node/persistent-memory-for-ai-coding-agents-an-engineering-blueprint-for-cross-session-continuity-999136960877).

### High-value — incorporated into v2 design below

5. **Quick vs deep save modes.** Sometimes you want a 2-line "paused mid-debugging" save vs a full checkpoint. v2 adds `/save quick` (1-line SESSION.md entry, current commit, task snapshot only) vs `/save` (full deep save). Argument parsing via `$ARGUMENTS`.

6. **No integration with native `claude --continue` / `claude --resume`.** Claude Code natively saves conversations and supports `claude --continue` and `claude --resume <session-id>` flags. v2's `/save` skill now suggests pairing with `/rename` so each named session = one workstream (e.g. session named "v2-canary-rollout").

7. **No age-out policy.** SESSION.md grows forever in v1. v2 spec: when SESSION.md exceeds 500 lines or 15 entries, the OLDEST entry gets moved to `docs/sessions-archive/SESSION-<YYYY-MM>.md`. v1 was missing this entirely.

### Deferred (nice-to-have, not blocking ship)

8. **Multi-scope memory tagging** — we partially have this via auto-memory file types (user / feedback / project / reference). Could add `session_id` and `app_id` scopes but the current taxonomy is working.
9. **Semantic retrieval over historical sessions** — needs vector DB / MCP; over-engineered for v1 of this skill.
10. **Git tag at save point** — clever but adds friction. Skip.
11. **CLAUDE.md update detection (pattern codification)** — could add "if same decision recurs 3+ times, suggest codifying in CLAUDE.md" but requires retroactive scanning. Defer.
12. **Automatic tool-use capture via hooks** (agentmemory pattern) — full hook-based silent capture is a much bigger architectural change. The `PreCompact` hook in #1 above is the minimum-viable version of this idea.

## Files to create (v2 — incorporates gaps 1–7)

| Path | What |
|---|---|
| `C:\Users\Yossi\.claude\skills\save\SKILL.md` | `/save` skill body (with `quick` arg support) |
| `C:\Users\Yossi\.claude\skills\resume\SKILL.md` | `/resume` skill body (with drift detection) |
| `C:\Users\Yossi\.claude\settings.json` (edit) | Add `PreCompact` hook that runs `/save quick` automatically before Claude Code auto-compacts the conversation |
| `C:\Users\Yossi\.claude\skills\save\README.md` | Short user-facing doc — when to use `/save` vs `/save quick`, the PreCompact auto-trigger, `/rename` pairing pattern |

Both skills are pure prompt-injection — markdown with YAML frontmatter. When user types `/save` (or `/resume`), the SKILL.md content becomes a standing instruction in the conversation; Claude executes it using the regular tools (Read/Edit/Bash etc.). `$ARGUMENTS` exposes whatever the user typed after `/save` (e.g. `quick`).

The `PreCompact` hook is the safety net: even if the user forgets to run `/save` before stepping away, Claude Code fires `/save quick` automatically when context approaches the compaction threshold. Catches the "rag window compressed → nothing lost" failure mode in the original ask.

No new file TYPES. No new conventions. Two reusable rituals + one hook to back them up.

## `/save` skill content (v2)

```markdown
---
name: save
description: Checkpoint the current session into existing project docs + auto-memory. Pass `quick` for a 1-line entry; default is deep checkpoint. Triggered automatically via PreCompact hook before context compaction. Never overwrites.
---

You are checkpointing the current session so a future Claude (or the same user on a new session) can pick up cleanly. **NEVER OVERWRITE — only amend / prepend.**

`$ARGUMENTS` may be empty (deep save) or `quick` (lightweight save, ~10s).

## Step 1 — Discover current state (read-only, parallel)

Run together:
- `git status --short`
- `git log --oneline -10`
- `git branch --show-current`
- `git remote -v` (so /resume knows where to push)
- Read `SESSION.md` first ~40 lines (latest entry — avoid duplicating it)
- TaskList — snapshot all incomplete tasks (pending + in_progress)

If a file doesn't exist, skip silently.

## Step 2 — Quick mode (if $ARGUMENTS = "quick")

Goal: ~10 seconds, defensive snapshot for PreCompact-triggered saves.

Prepend a single block to SESSION.md:

```
## <YYYY-MM-DD HH:MM UTC> — QUICK SAVE (pre-compaction or manual)
- Branch: <branch>; latest commit: <hash> <msg>
- Working tree: <clean | N modified>
- In-flight tasks: <comma list of in_progress task subjects>
- Last user intent (one sentence): <last 1-2 user messages summarized>
- Next action: <what would happen next if session continued>
```

Then report 3 lines to the user. STOP. Do NOT touch PROGRESS.md / DECISIONS.md / MEMORY.md in quick mode.

## Step 3 — Deep mode (default — no $ARGUMENTS)

Goal: full checkpoint. Categorize the conversation into:

- **Done work** — what shipped (commits, features, fixes, infra deployed). Verify with `git log`.
- **Decisions made** — concrete choices with rationale (which tool, which approach, why). Skip trivial preferences.
- **In-flight / paused** — what's mid-stream + the exact next action to resume + why it paused
- **Memory-worthy facts** — user preferences, recurring patterns, new infra accounts → auto-memory
- **Outstanding TODOs from TaskList** — snapshot in-progress + pending tasks (for /resume to recreate)

Skip:
- Trivial back-and-forth, already-documented items, speculative ideas user didn't commit to.

## Step 4 — Write files (deep mode only)

Each file gets a STRUCTURED briefing format optimized for a fresh-context LLM to read.

### SESSION.md (project root) — prepend new section

Top-of-file template:

```
## <YYYY-MM-DD> → <YYYY-MM-DD> — <one-line headline>

### Briefing for next session (read first)

- **Where we are:** <2-3 sentences on current state of the work>
- **Next concrete action:** <one sentence — what command/click/edit happens next>
- **Constraints to preserve:** <user preferences, scope guards, deferred items relevant to next action>
- **Critical data:** <links, IDs, URLs, commits the next session must know>

### Done this session
<bullet list of shipped items with commit hashes>

### Decisions made
<bullet pointers to DECISIONS.md anchors>

### In-flight tasks (recreate with TaskCreate on /resume)
<list of incomplete tasks: subject, current status, why paused>

### Paused / blocked
<list of things waiting on user / external / time>

### Code commits — <date>
<table: hash | type | summary>
```

PRESERVE all prior entries verbatim.

### PROGRESS.md (project root) — surgical edits

Update the `## Now — next session` section by editing the pickup-action subsection to reflect current state. Move stale pickup notes under `### Historical pickup notes from prior session` (don't delete).

Prepend a new `### <date> — <headline> ✅` entry at the top of `## Done`. Preserve all existing Done entries.

### DECISIONS.md (project root) — prepend

New `## <date> — <topic>` section at top (after preamble). Each decision: `### Decision N — <name>` with Context / Options / Chose / Implications / Lesson.

Preserve all prior decision sections verbatim.

### MEMORY.md (auto-memory — `~/.claude/projects/<project-dir>/memory/MEMORY.md`)

If a new memory is warranted (project pickup, new feedback, new reference), create a new memory file under that same dir with standard frontmatter. Append a one-line index entry to MEMORY.md.

NEVER overwrite an existing memory file unless fixing outdated info — and even then, prefer creating a fresh dated file (e.g. `project_pickup_YYYY-MM-DD.md`).

## Step 5 — Save scratch plan if durable

If `C:\Users\Yossi\.claude\plans\*.md` has a plan from the current session with durable content (not throwaway design notes), copy it into the project as `docs/<topic>-PLAN.md` so it survives session end.

## Step 6 — Age-out (deep mode only, when needed)

If SESSION.md exceeds 500 lines OR 15 entries, move the OLDEST entry to `docs/sessions-archive/SESSION-<YYYY-MM>.md` (create dir + file if missing). Append at top of archive. Leave a one-line breadcrumb in SESSION.md ("Older entries archived → docs/sessions-archive/...").

## Step 7 — Report

End with a tight summary (max 10 lines):
- Which files were touched + what kind of change (prepended / amended / new)
- The single most important "next action" line
- Whether anything is uncommitted
- If quick mode: just say "quick save complete; full /save recommended before ending session"

DO NOT commit changes unless the user explicitly asks. Leave updates uncommitted for review.

## Pairing with native session management

Consider suggesting (once per session): `claude --rename "<workstream-name>"` so this Claude Code session is named after the workstream. Combined with `claude --continue` and `claude --resume <id>`, it gives an additional layer of within-Claude-Code session persistence beneath the doc layer.
```

## `/resume` skill content (v2)

```markdown
---
name: resume
description: Reconstruct where the prior session left off — read SESSION.md briefing + git state + auto-memory + in-flight tasks. Detect goal drift. Recreate tasks. Report in 8 lines.
---

You are picking up a project mid-stream. Goal: tight, scannable summary so the user hits the ground running. End with a sanity check that the user's current intent matches the prior session's stated next action.

## Step 1 — Gather (read-only, parallel)

Run together:
- `git status --short`
- `git log --oneline -10`
- `git branch --show-current` + `git rev-list --count origin/main..HEAD` (commits ahead)
- Read first ~120 lines of `SESSION.md` (latest entry — should contain the briefing block)
- TaskList (likely empty at session start — that's fine; we'll repopulate)
- Read `MEMORY.md` (auto-memory) — find the latest `project_pickup_*.md` entry; read it

Fallback when SESSION.md missing: read PROGRESS.md "Now" section + recent commits. Report degraded mode in the response.

## Step 2 — Re-create in-flight tasks

If SESSION.md's latest entry contains an `### In-flight tasks` section, parse each line and call `TaskCreate` for each one with status `pending` (or `in_progress` for the one explicitly flagged as active). This rebuilds the rolling task panel — `Ctrl+T` will show them again.

If there are no in-flight tasks, skip silently.

## Step 3 — Report (max 12 lines)

Output in this exact shape:

```
Last session: <date range> — <one-line headline>

Where we are:
- Branch: <branch-name> (<N> commits ahead of origin if applicable; clean | <N> modified)
- Latest commit: <hash> <message>
- Auto-memory: <name of pickup memory file if found, else "no project pickup memory">

Next concrete action (from SESSION.md):
> <verbatim quote of the "Next concrete action" line from the briefing block>

Constraints to preserve:
- <bullet list of 2-4 from SESSION.md "Constraints to preserve">

Tasks recreated: <N> (<list of subject names>)
```

## Step 4 — Surface red flags

Append a `⚠ Red flags` section at the bottom if any of these are true:
- Branch is ahead of origin but not pushed
- Uncommitted changes that look important (non-doc files — check `git status` for code files)
- An in-flight task references "paused", "blocked", "waiting on", or similar
- SESSION.md's "Next concrete action" mentions an external dependency (cron, deploy, third-party)
- Pickup memory is older than 7 days (project may have drifted further since)

## Step 5 — Goal-drift check (the failsafe)

After reporting, look at the user's MOST RECENT message in this conversation (the one that triggered /resume — usually just "/resume" or "resume" or "where are we"). If the user's CURRENT intent (from preceding messages in this NEW session, if any) appears different from SESSION.md's stated "Next concrete action":

Append one explicit confirmation question:

> "Last session pointed at <X>. Your current message looks like <Y>. Did you want to continue toward <X>, or pivot to <Y>?"

If user replies confirming the prior action, proceed. If user replies pivoting, save the prior action as a deferred item in SESSION.md before pivoting.

If user's intent and the prior action match, no question needed — just say "intent matches prior session" in one short line.

## Step 6 — Wait for instruction

Do not take any work action yet. Just report.

If the user replies "go" / "continue" / "yes" / "proceed" or similar, THEN start work on the surfaced next concrete action.
```

## PreCompact hook config

Edit `C:\Users\Yossi\.claude\settings.json` (create file if missing) to add:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "claude /save quick"
          }
        ]
      }
    ]
  }
}
```

If `settings.json` already exists with other hook entries or settings, MERGE the `PreCompact` array into the existing `hooks` block rather than overwriting.

**What this does:** before Claude Code auto-compacts the conversation history (lossy summary), it fires `/save quick` first. The 1-block SESSION.md entry gets written so even if compaction loses fidelity, the durable doc has the critical state.

**Caveat:** the `command` form assumes the user's shell can find `claude` on PATH. If they invoke Claude Code via a different binary path on Windows, swap the command accordingly. Verify with `where.exe claude` after install.

## Optional companion — `~/.claude/skills/save/README.md`

Short user-facing doc explaining when to use what:

- Manual `/save` (deep) — end of working session, before closing the laptop
- Manual `/save quick` — stepping away briefly, want a defensive snapshot
- Auto-fired `/save quick` (via PreCompact hook) — runs without your input before auto-compaction
- Manual `/resume` — start of a new session in any project
- Pair with `claude --rename "<workstream>"` to align named sessions with named workstreams

## Verification (post-build)

Run these in order; each gates the next:

1. **`/save quick`** — should write a single new block at top of SESSION.md within ~10 seconds. Confirm via `git diff SESSION.md` that nothing else was touched.

2. **`/save`** (deep, in this current daven-site project) — should:
   - Prepend a `## <date> — <headline>` section to SESSION.md with the `### Briefing for next session` block populated
   - Update PROGRESS.md "Now" section + prepend a "Done" entry
   - Prepend a section to DECISIONS.md if any decisions were made this session
   - Possibly create a new memory file under `~/.claude/projects/<dir>/memory/`
   - End with a tight summary
   - `git diff` shows only prepends / amendments — nothing overwritten

3. **`/resume`** in a NEW conversation (cmd+N or close + reopen) — should:
   - Report the 8-line state block citing today's SESSION.md entry
   - Recreate the in-flight tasks via TaskCreate (verify with `Ctrl+T`)
   - Surface red flags if branch unpushed / important work uncommitted
   - End with goal-drift check if no clear user intent, else "intent matches prior session"

4. **PreCompact hook** — load a long-context conversation until auto-compaction triggers. Should see `/save quick` fire and append a block to SESSION.md before the compaction summary replaces context. Verify with `git log SESSION.md` showing a recent modification within ~1 minute of compaction.

5. **Edge: brand-new project** — `cd` into a project that has no SESSION.md / PROGRESS.md / DECISIONS.md and run `/save`. Skill should write SESSION.md only and skip the others (or create them with starter scaffolding if user opts in). No errors.

6. **Edge: no prior session for `/resume`** — `cd` into a project with no SESSION.md and run `/resume`. Skill should report "no prior session found in this project; degraded report from git log + PROGRESS.md" and recommend running `/save` after the first work cycle.

7. **Edge: pivot mid-session** — in a session where the prior `next concrete action` was "deploy v2 canary", start the new session with a clearly different intent ("let's refactor the auth flow"). `/resume` should fire the goal-drift question, not silently route you into the wrong work.

## Out of scope (deliberate)

- **No auto-load on session start** — user picked Option B (manual `/resume`), not Option C (auto-fire on every conversation start). Auto-load adds friction to every trivial question; Option B is opt-in.
- **No project-level overrides yet** — user picked user-wide scope. If a project needs custom save behavior later, drop a `.claude/skills/save/SKILL.md` in that project root (project-scope wins per Claude Code skill resolution).
- **No git commits or pushes** — skill explicitly does NOT commit. User reviews + commits separately. (Avoids accidentally committing half-finished work or sensitive `.env.local` snapshots that wandered into the conversation.)
- **No vector / semantic search over historical sessions** — gap 9; needs a vector DB or MCP server; over-engineered for now. If the project grows to 50+ SESSION.md entries and search becomes a pain, revisit.
- **No retroactive CLAUDE.md pattern codification** — gap 11; would need a scan over all prior DECISIONS.md entries to detect "this decision recurred 3+ times → suggest codifying." Defer.
- **No full agentmemory-style silent tool-use capture** — gap 12; much larger architectural change. The PreCompact hook in this plan is the minimum-viable version of that idea.

## Rollback / uninstall

- Delete `C:\Users\Yossi\.claude\skills\save\` and `C:\Users\Yossi\.claude\skills\resume\` directories
- Remove the `PreCompact` block from `~/.claude/settings.json`
- Any SESSION.md / PROGRESS.md / DECISIONS.md content the skill wrote stays as-is — these are project files the user owns

Zero residual state. Easy to back out if the skill misbehaves.

## Implementation order (when this plan is approved)

1. Create `~/.claude/skills/save/SKILL.md`
2. Create `~/.claude/skills/resume/SKILL.md`
3. Create / edit `~/.claude/settings.json` to add the PreCompact hook (merge if existing)
4. Create `~/.claude/skills/save/README.md` (the short user-facing doc)
5. Test `/save quick` on daven-site (verification step 1)
6. Test `/save` deep on daven-site (verification step 2)
7. Open new session, test `/resume` (verification step 3)
8. Long-running conversation to test PreCompact hook (verification step 4)
9. Report success + suggest user run `/save` themselves at end of each session going forward
