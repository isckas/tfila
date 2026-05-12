# STYLE.md — tfila.co design principles

These rules apply to every UI surface on tfila.co. When in doubt, default to "less."

---

## North star

**Minimal clicking, simple clean aesthetics.**

Every screen should:
- Communicate its purpose at a glance
- Surface the primary actions where the user already is — don't make them navigate to a separate page to do the thing
- Use whitespace generously; restraint beats decoration every time

---

## Rules

### Minimal clicking

- **If a task takes N clicks today, find a way to do it in N − 1.** Always.
- **Forms live where the user reads about them.** If a card is "Add a shul," the URL input and Submit button are *on* that card — not behind a nav link to a separate page.
- **Don't auto-redirect** away from a page the user just navigated to. Auto-*restore* state silently (saved location, preferences) but always let the user reach the page they clicked toward. Use an opt-in "Resume" callout instead of an automatic bounce.
- **One obvious primary action per screen.** Secondary actions are visually lighter (smaller, less color, no fill).
- **Live feedback beats roundtrips.** Search inputs match as the user types (client-side fuzzy when the dataset is small enough). Avoid "type and hit Enter to see results" patterns.

### Simple aesthetics

- **Tailwind utility classes only.** No custom CSS unless absolutely required.
- **Neutral palette + one accent (`amber-800`).** Never introduce a third color family. State colors (`emerald` for success, `rose` for error, `amber` for caution) are allowed sparingly inside banners.
- **Cards:** `rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm`. That's the default — diverge only with reason.
- **Icons are emoji-as-glyph** (📍 🔍 ➕). No icon library, no SVG sprite.
- **Type scale:** hero `text-4xl`, section heading `text-lg`, body `text-sm`, caption/meta `text-xs`. Avoid intermediate sizes unless layout demands it.

### Density and spacing

- **Mobile first.** Test at 360px wide before adding desktop polish. If it works on a phone, it works everywhere.
- **Vertical rhythm:** `gap-3` inside groups, `gap-6` between sections, `py-8` page padding (`py-10`+ for landing pages).
- **Stack on mobile, grid on tablet+** (`md:grid-cols-N`). Three-column grids start collapsing at `md:` not `sm:`.
- **Tap targets ≥ 36×36 px** on mobile (`py-2` minimum on buttons, larger on primary CTAs).

### Copy

- **Direct and low-jargon.** "Find a minyan near me" — not "Locate nearby prayer services."
- **Verbs in headings**, not nouns. "Find a minyan" / "Look up a shul" / "Add a shul" — not "Minyan Finder" / "Shul Directory" / "Shul Submission."
- **One sentence per supporting paragraph.** If you need two, you're explaining too much; show, don't tell.
- **Domain abbreviations** (zmanim names, halachic terms) get `title=` tooltips, not paragraph explanations.
- **Error states tell the user what to do next**, not just what went wrong.

### Accessibility

- Every interactive element is keyboard-reachable.
- Form inputs have a visible `<label>` or a descriptive placeholder.
- Color is never the only signal of state — pair it with text, an icon, or a border.

---

## When to break these rules

- **Admin surfaces** (`/admin/*`) can be denser and more information-rich than public pages. Density and minimalism rules above target *public* surfaces.
- **Long-form pages** (`/bot`, future `/about`) can use larger type scales and prose-style paragraphs.

---

## What "done" looks like for any UI change

1. View the page at **360 px** (mobile), **768 px** (tablet), and **1280 px** (desktop). Each should feel intentional, not just functional.
2. The **primary action is obvious within ~2 seconds** of landing. If a teammate had to ask "what do I do here?", the design isn't done.
3. **No extra clicks vs. the prior state.** If the change adds a click, justify it explicitly in the PR description.
4. **No new color families, fonts, or icon libraries.** Reuse what's there.
