<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Clarify before building

**Before making code changes for any new feature**, ask the user **3 clarifying questions** about scope and intent. This catches misunderstandings before they become rework.

The bar is "new feature," not "every change." Skip the clarifying step for:
- A bug fix where the bug is concrete and reproducible (file + line + observed-vs-expected)
- A typo / copy edit / doc tweak the user spelled out
- A trivial rename, log line, comment, or formatting change
- Continuing work the user already approved in this conversation (e.g. "now do the same for X")

Use the clarifying step when:
- The user describes an outcome and the implementation has real choices (UI shape, data model, where it lives, what triggers it)
- Multiple shipped behaviors could satisfy the request
- You're tempted to assume defaults — that's the signal you need to ask

**Format the questions** with `AskUserQuestion` and present 2-4 well-distinct options per question (not "yes/no"). Lead with the recommended option labeled `(Recommended)` so the user can rubber-stamp the path you'd take. Ask all 3 in one call.

**Topics worth asking about** (pick the 3 most load-bearing for the feature):
- Scope — is this one PR or split into stages?
- Surface — which page/route does it live on?
- Defaults — what's the empty state, the no-data state, the error state?
- Trigger — automatic vs admin-action vs user-action?
- Persistence — store in DB, or compute on the fly?
- Failure mode — silent no-op, log + continue, hard error?
- UX tier — minimum-viable vs polished?

Once the user answers (or says "go" without answering), proceed. Don't ask more than 3 unless they explicitly invite follow-ups.
