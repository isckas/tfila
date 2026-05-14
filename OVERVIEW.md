# tfila.co — what it is, how it works, what runs it

This is the plain-English tour of the whole project. No jargon assumed. Read it end-to-end if you want to understand everything, or skim the table of contents and dip in.

If you ever need to map something back to its technical name so you can search for it in code or in a vendor's dashboard, there's a **Plain → technical glossary** at the very bottom.

---

## Table of contents

1. [What is tfila.co](#1-what-is-tfilaco)
2. [What's different from existing shul directories](#2-whats-different-from-existing-shul-directories)
3. [What someone sees when they open the site](#3-what-someone-sees-when-they-open-the-site)
4. [Where the shul information comes from](#4-where-the-shul-information-comes-from)
5. [How we read a shul's website](#5-how-we-read-a-shuls-website)
6. [How we know which page on the website to read](#6-how-we-know-which-page-on-the-website-to-read)
7. [What happens when a website blocks us](#7-what-happens-when-a-website-blocks-us)
8. [How information stays fresh week after week](#8-how-information-stays-fresh-week-after-week)
9. [What you (the admin) actually do](#9-what-you-the-admin-actually-do)
10. [The services we pay (or don't pay) for, one by one](#10-the-services-we-pay-or-dont-pay-for-one-by-one)
11. [What's stored, in plain English](#11-whats-stored-in-plain-english)
12. [What it costs to run, today and at scale](#12-what-it-costs-to-run-today-and-at-scale)
13. [What can go wrong and how we handle it](#13-what-can-go-wrong-and-how-we-handle-it)
14. [What we deliberately don't do](#14-what-we-deliberately-dont-do)
15. [What's coming next](#15-whats-coming-next)
16. [Plain → technical glossary](#16-plain--technical-glossary)

---

## 1. What is tfila.co

A website (and installable phone app) that answers one question for an observant Jew: **"where's the next minyan near me?"**

Open it. It uses your phone's location. It shows you the upcoming minyanim at shuls within walking distance, sorted by which one starts soonest — including ones that already started in the last half hour, because you might still be able to slip in.

Tap any shul to see the full week's schedule, the address, a map, distance from you, and when the shul's information was last verified.

That's the whole product. The hard part is **keeping the times accurate** — every shul, every week, including holiday schedules — without asking shul gabbais to maintain anything.

---

## 2. What's different from existing shul directories

Almost every other Jewish-shul directory you've seen has the same problem: **the data rots**. Someone posts their shul's times in 2019, the shul changes Mincha by 15 minutes in 2024, the directory still shows the old time, the davener shows up late.

tfila.co solves this two ways:

1. **We never ask shuls to maintain anything**. The shul already publishes its schedule somewhere — on its website, in its weekly email bulletin. We read from that source directly. If their schedule changes, ours does too. Automatically.
2. **We re-check every shul once a week**, on Saturday night, so Sunday-morning daveners get fresh data. If a shul changes its Mincha time on Friday, we catch it on Saturday.

The cost is technical: we need to be able to read pretty much any shul's website or weekly email, in any format the shul happens to use, and pull out the minyan times reliably. Most of the technology here is in service of that.

---

## 3. What someone sees when they open the site

### First time (no location yet)

Three big tiles on the homepage:

- **📍 Find a minyan** — a button that asks the phone for your location. Once you say yes, the page reloads as the minyan feed (below). If you'd rather not share location, you can type an address.
- **🔍 Look up a shul** — a search box that filters across every shul we know about. Type "agudath" and you see Agudath Israel of Lakewood, Agudath Israel of West Side, etc.
- **➕ Add a shul** — for anyone who notices their shul is missing. Two paths: paste a URL, or forward a weekly email.

### After granting location

The page becomes a vertical list of upcoming minyanim. Each row shows:
- Which shul
- Which prayer (Shacharis / Mincha / Maariv)
- When it starts (in minutes from now, plus the absolute time)
- How far away the shul is
- Walking direction icon to open Google Maps

Above the list, a strip of **zmanim** (today's halachic times — sunrise, sof zman shema, sunset, etc.) so the davener has full context for what they're choosing between.

### Tapping into a shul

A dedicated page for that shul:
- Name, address, distance from you, neighborhood
- Today's schedule, prominently
- A collapsed "Other days of the week" disclosure
- A zmanim grid for the shul's location (zmanim depend on latitude/longitude, so each shul's grid is its own)
- A small embedded map
- A "Times above are extracted from this URL" attribution line so we're transparent about our source
- A "Last updated" timestamp so the davener knows how fresh the data is

That's it. The user-facing product is intentionally simple. The complexity lives behind the scenes.

---

## 4. Where the shul information comes from

A shul gets into the system in one of three ways:

### Way 1: a davener submits a URL

The "Add a shul" tile leads to a form. Someone pastes their shul's website URL and (optionally) a contact email. Behind the scenes:
- We check whether this URL or its domain is already in the system (so we don't create a duplicate).
- If the URL is just a homepage (`https://exampleshul.org`), we try to find the actual schedule page on the site — schedules are usually buried at a deeper path like `/schedule` or `/davening-times`. (Section 6 explains how.)
- We create a placeholder entry for the shul and start an extraction job.
- ~30 seconds later, we've read the shul's site, pulled out the minyan times, and the entry is waiting for you (the admin) to review.

### Way 2: a davener forwards their shul's weekly email

Most shuls send out a weekly bulletin email with that week's schedule. Daveners can forward that email to **submit@tfila.co** and we pick up the schedule from it. Behind the scenes:
- The email arrives at Cloudflare (the company that handles the `tfila.co` domain's email routing).
- Cloudflare runs a small program we wrote that reads the email, identifies who originally sent it (the shul, not the forwarder), and sends it to our app.
- Our app extracts the schedule from the email body using AI.
- If a shul already exists with the same website domain, we attach this email as another source under that shul. Otherwise we create a new shul entry.
- Done in ~30 seconds.

### Way 3: discovery — we proactively look for shuls

The newest path. We don't wait for daveners to submit shuls; we go find them.

- We keep a list of **88 ranked geographies** worldwide where observant Jews live or travel — Crown Heights, Boro Park, Lakewood, Five Towns, Toronto's Bathurst corridor, Beit Shemesh, Aspen for ski Pesach, Cancun for vacation, and so on. Each entry has a center point and a radius.
- From the admin section you pick a geography and click **Run**.
- We ask Google Maps for every place tagged "synagogue" inside that radius. Google returns up to 20 results: name, address, website, etc.
- Each result becomes a **candidate** — an entry in a separate holding pen, NOT yet a real shul in the public listing.
- You review the candidates: approve the real shuls, reject the false positives (a Hebrew school that Google miscategorized, a defunct shul, etc.). Approving creates a real shul entry and triggers extraction.

All three paths converge on the same downstream pipeline: we end up with a shul entry and we extract its minyan times. The next sections cover how.

---

## 5. How we read a shul's website

Shul websites come in every conceivable shape. A 2003 GeoCities-style page. A modern WordPress theme. A ShulCloud-managed site. A page where the schedule is an image (a graphic the shul re-makes every week). A page where the schedule is buried in a PDF bulletin. We need to handle all of them.

The trick: we don't write custom code per shul. We use AI. Specifically, we use **Claude** (an AI made by Anthropic, similar to ChatGPT but better at this kind of structured extraction). Claude can read a webpage and tell us "here's the schedule" with surprising accuracy.

But Claude is most accurate when given clean text. So we have a four-step **cascade**: we try the cheapest, simplest approach first; only if it fails do we try the next, more expensive one.

### Step 1: read the page as plain HTML

We fetch the page like a regular browser. Strip out all the noise (CSS, JavaScript, ads, navigation menus). Send what's left to Claude. Ask: "What are the minyan times on this page?"

Most shul sites work at this level. WordPress, basic HTML, ShulCloud sites where times are part of the article text — all fine.

**Cost**: fractions of a cent. The cheap AI model (Claude Haiku) handles the easy ones; if it's unsure, we promote to the smarter model (Claude Sonnet) and check.

### Step 2: render the page like a real browser, then re-read

Some shul sites don't put the schedule in their HTML at all. They load it via JavaScript after the page loads. If we read the raw HTML we just see a skeleton.

For those sites we use **Browserless** — a service that runs a real Chrome browser on a remote server. It loads the page, lets the JavaScript run, then sends us the resulting HTML (which now includes the schedule). We feed that to Claude.

**Cost**: a fraction of a cent per page render via Browserless.

### Step 3: read the schedule as an image

Some shuls publish their weekly schedule as a graphic image — a one-page poster they design each week. The image has text, but a website-reader sees it as a picture.

Claude can read images. So if the regular extraction failed, we look at every image on the page, identify the one most likely to be a schedule (by its filename, ALT text, or position on the page), and ask Claude to read it like a person would.

**Cost**: a few cents per image read.

### Step 4: read the schedule from a linked PDF

Some shuls publish their bulletin as a PDF that's linked from their homepage ("This Week's Bulletin →"). We find that PDF, download it, and hand it to Claude (which can read PDFs).

**Cost**: a few cents per PDF.

### What happens if all four fail

The shul is marked **unsupported**. It stays in our database with a note explaining what we tried. The admin can manually re-trigger extraction later (sometimes a site gets fixed and what failed last week works this week). The shul isn't published on the public feed until extraction succeeds.

The whole cascade typically completes in 10-60 seconds depending on how many tiers had to run.

---

## 6. How we know which page on the website to read

A common problem: the davener submits `https://exampleshul.org`. That's the homepage. The actual schedule lives at something like `https://exampleshul.org/davening-times` or `https://exampleshul.org/templates/articlecco_cdo/aid/2710598/jewish/Times-and-Schedule.htm` (yes, real example from a Chabad-hosted site).

If we just read the homepage, we get a welcome message + a "About Our Shul" paragraph + zero schedule.

Three things help us land on the right page:

1. **Common paths.** Most shul sites use a path containing one of about 15 common words: `/schedule`, `/times`, `/minyan`, `/davening`, `/worship/shabbat`, `/tefilla`, and so on. We try each one in order. If one of them returns a page that contains both schedule-like keywords AND time-like text, we use it.
2. **Navigation scanning.** If the common-path try misses, we look at the homepage's own navigation menu. Any link whose text or URL contains "schedule" / "times" / "davening" / etc., we follow.
3. **AI scout.** If even the navigation scan misses (some shuls have opaque URLs that don't include any keyword in the link), we send the entire navigation menu to Claude and ask: "which of these links is most likely the minyan schedule?" Claude picks one. We use that.

Cost: free for steps 1-2 (just HTTP requests). About a half-cent for step 3 (the AI scout). Most shuls resolve at step 1 or 2 and never hit the AI scout.

Once we've found the right page, the extraction cascade from section 5 runs against it.

---

## 7. What happens when a website blocks us

Some shul websites are protected by anti-bot systems. The most common case: Chabad.org-hosted shuls. When we try to read one of those pages from our normal server, we get a "403 Forbidden — bot detected" response instead of the schedule. The page itself is fine; the bouncer at the door just doesn't recognize us.

Trying a different "I'm a regular Chrome browser" identity doesn't help here — these sites check what IP address the request comes from. Our app runs on Vercel, which uses Amazon's cloud, and Amazon's IP addresses are well-known. Anti-bot systems flag them.

So we have a **backup messenger**: a small program running on **Cloudflare's** network. Cloudflare is a different company with their own network of servers around the world, and their IPs aren't blocked by these anti-bot systems. When our normal request gets refused, we hand the request to our Cloudflare program, which fetches the page from its end and forwards the result back to us.

It's the same program that handles inbound emails at `submit@tfila.co` — Cloudflare lets us run small bits of code on their network for free, so we use one program for two related jobs.

The user never sees any of this. From their perspective, the shul's schedule just shows up. From our perspective, the audit log records that we needed a Cloudflare assist to get there.

---

## 8. How information stays fresh week after week

Discovering and reading a shul once is easy. The hard part is keeping it accurate forever.

Every Saturday night around 10pm Eastern Time (right after most Shabbosim end on the East Coast), a scheduled job runs:

1. For every shul we've previously verified, re-check the source.
2. If the source's content hasn't changed since last time, do nothing (a content-hash comparison — we keep a fingerprint of the page from last week, compare, skip the AI re-read if identical).
3. If the content has changed, run the cascade again, get the new schedule.
4. If the new schedule looks suspicious (significantly fewer rules than before, or extraction confidence dropped), mark the shul for admin review instead of silently replacing the rules. This is a guardrail: bad weeks at the shul (typo in a bulletin, broken page) shouldn't silently wipe out valid data.

Daveners arriving Sunday morning see times that were verified within the last 24 hours.

If a shul had a special schedule (Yom Kippur, fast day, three weeks, etc.) those are stored as separate date-bounded rules and apply on top of the recurring weekly schedule.

---

## 9. What you (the admin) actually do

The admin is **one person** (you). Magic-link login — no password to remember; you enter your email, a one-time login link arrives in your inbox, you click it.

Day-to-day work in priority order:

1. **Review the queue.** New submissions and discovery candidates land here. For each, you skim what the AI extracted — does it look right? You can edit the URL, manually re-run extraction, or reject.
2. **Triage discovery candidates.** After running Places discovery for a geography, the new candidates appear in `/admin/candidates`. You click through, approve real shuls (one click — the shul appears in the public listing within seconds), reject the false positives.
3. **Fix broken sources.** If a shul's website changed structure and extraction broke, you get notified. You either fix the URL, manually edit times, or mark the shul as unsupported.
4. **Run discovery for new geographies.** When you decide it's time to launch in Boro Park, you go to admin → candidates → pick "Boro Park, Brooklyn" → Run. ~30 seconds later you have ~30 candidates to triage.

There's also a per-shul admin page that shows the full history: every extraction attempt, what the AI saw, what rules it produced, when each was reviewed. Useful for debugging "why does this shul show wrong times."

The admin interface is currently spread across a few pages (Queue, Candidates, All shuls, Per-shul, Per-source) that grew up organically as features were added. It works but it's gotten convoluted — a unified workflow view is on the to-do list.

---

## 10. The services we pay (or don't pay) for, one by one

The whole site runs on **eleven external services**, most of them free at our current scale. Here's each one, what it does, what it costs, and what would happen if it disappeared tomorrow.

### Vercel — where the website lives
- **What it is**: a hosting company. When you visit tfila.co, the page comes from Vercel's servers.
- **Why we use them**: best fit for Next.js (the framework the website is written in). Automatic deploys whenever we push code. Built-in SSL, CDN, function hosting — we don't have to manage any servers.
- **Cost**: $0 (hobby plan, sufficient at our scale). Would jump to ~$20/month if we exceed hobby limits.
- **If they disappeared**: we'd migrate to Netlify or self-host on a VPS. ~4-8 hours of work.

### Neon — the database
- **What it is**: a database service. Specifically PostgreSQL, the same database used by most modern web apps. Neon is the company hosting it.
- **Why we use them**: free tier is generous, scales smoothly, supports the geography features we need (find every shul within X miles of a point).
- **Cost**: $0 (free tier). Would jump to $19/month at the next tier.
- **If they disappeared**: any other PostgreSQL host (Supabase, RDS, Heroku, etc.) would work. Migration would take a day.

### Anthropic — the AI that reads shul sites
- **What it is**: the company that makes Claude (the AI we use for extraction). Pay-per-use API.
- **Why we use them**: Claude is currently the best AI for structured extraction (turning messy HTML into clean schedule data). They're also more transparent about their model versions than competitors.
- **Cost**: pay-per-call. Tiny amounts add up: about half a cent to read a forwarded email, about 2-5 cents to do a full cascade extraction on a website. At our current scale (~65 shuls) we spend a few dollars a month.
- **If they disappeared**: OpenAI's GPT-4 or Google's Gemini could substitute. We'd need to re-tune the prompts; a week of work.

### Inngest — the background-job manager
- **What it is**: a service that runs reliable background jobs. When we say "re-scrape every shul Saturday at 10pm", Inngest is what actually triggers it on schedule. When we say "this new email submission should be processed in the background", Inngest queues it and runs it with automatic retries if something fails.
- **Why we use them**: doing this ourselves (writing reliable background workers from scratch) would take weeks of engineering and constant maintenance. Inngest gives us all of it for free at our scale.
- **Cost**: $0 (free tier). The first paid tier kicks in around 10,000 jobs/month, which is much more than we'll see anytime soon.
- **If they disappeared**: we'd switch to AWS Lambda + SQS, or Trigger.dev. A week of work to migrate.

### Browserless — the remote browser
- **What it is**: a service that runs Chrome on a remote server. You give it a URL; it loads the page (including running all JavaScript on it), and gives you back the resulting HTML.
- **Why we use them**: some shul sites load their schedule via JavaScript only. Running a real Chrome on every server we own would be impractical. Browserless does it as a service.
- **Cost**: $0 (free tier — 1,000 page renders per month, well above our usage).
- **If they disappeared**: alternatives are Puppeteer-on-AWS or Bright Data. Day of work to migrate.

### Google Maps APIs — geography and discovery
Two separate APIs from Google, but one API key.
- **Google Geocoding**: turn an address into latitude/longitude (so we can locate the shul on the map) and reverse — turn coordinates back into a neighborhood name ("Crown Heights, NY").
- **Google Places**: search for "synagogue" in a geographic area. Used by the discovery system in section 4.
- **Cost**: pay-per-call. Free tier covers about $200/month. We currently spend well under that.
- **If they disappeared**: Mapbox or HERE could substitute for geocoding. For Places discovery, there's no real equivalent — we'd shift more weight onto user submissions and directory crawls.

### Cloudflare — DNS, email routing, anti-bot bypass
- **What it is**: Cloudflare provides three separate things for us:
  - DNS (the service that maps `tfila.co` to a server)
  - Email routing (when someone sends mail to `submit@tfila.co`, Cloudflare receives it and runs our small program against it)
  - The anti-bot bypass proxy from section 7
- **Why we use them**: free, fast, all three jobs from one provider. Their Workers product (small programs that run on Cloudflare's edge network) is what powers the email handling and the proxy.
- **Cost**: $0 (free tier covers all three at any volume we'll hit).
- **If they disappeared**: DNS we'd move to Porkbun. Email routing → SendGrid Inbound or Postmark (~$15/mo). Anti-bot proxy → we'd need a different hosting provider that offers edge functions.

### Resend — outbound email
- **What it is**: a service that sends emails (the "send" side of email). When the admin clicks "send me a magic-link login", Resend is what delivers that to your inbox.
- **Why we use them**: small, modern, simple API. Good deliverability.
- **Cost**: $0 (free tier — 100 emails/day).
- **If they disappeared**: SendGrid, Mailgun, Postmark, AWS SES — all interchangeable.

### Anthropic, Google, etc. — we count those above. Other services worth mentioning:

### Porkbun — domain registrar
- **What it is**: where we registered the `tfila.co` domain.
- **Cost**: ~$10/year.
- **If they disappeared**: any registrar works. Cloudflare even offers free domain registration (at-cost).

### GitHub — source control
- **What it is**: where our code lives. Public-ish (the repo is private, but the platform is GitHub).
- **Cost**: $0.

### Tailwind, Drizzle, Next.js, React — these are the tools we use to write code

Not services we pay for — these are open-source software libraries. The website itself is built using them. They don't show up on any bill.

---

## 11. What's stored, in plain English

The database has about a dozen tables. Here are the ones that matter:

### `shul`
One row per synagogue. Each row holds the name, slug (URL-friendly version of the name), address, latitude/longitude, timezone, optionally nusach (Ashkenaz/Sefard/etc.), the URL we extract from, the contact email if known, and the current status (pending review / active / broken / etc.).

### `data_source`
One row per **source of information** for a shul. A single shul can have multiple sources — e.g. one from a URL submission, one from a forwarded email. Each source has a "priority" so we can resolve conflicts (email sources are most authoritative because gabbais write them; website sources come second).

This is also where the audit trail lives: each source records what we extracted, which AI model produced it, how confident the AI was, and a per-attempt breakdown of how the extraction cascade went.

### `minyan_rule`
One row per **time rule**. Examples:
- "Shacharis at 7:00 AM, Monday through Friday, at shul #42"
- "Mincha at 18 minutes before sunset, on Shabbos only, at shul #18"

The "time" field is stored as either a fixed clock time OR a zmanim anchor (a reference to a halachic time like sunrise or sunset) plus an offset. This is how we handle "10 minutes before shkia" or "5 minutes after netz" — we don't store the resolved time, we store the rule, and resolve it at query time based on today's date and the shul's location.

Rules can be date-bounded (valid only on specific dates — for Yom Kippur, fast days, etc.) or open-ended (the regular weekly pattern).

### `scrape_run`
Audit log. One row per re-scrape we run. Records when it happened, what changed, whether it succeeded.

### `shul_candidate`
The discovery system's holding pen. One row per place Google Places returned to us that we haven't decided about yet. Each row has the place's name, address, lat/lng, website, what status (pending / approved / rejected / etc.). Once approved, a candidate creates a real `shul` row and the candidate row is marked "approved" but kept for audit.

### `discovery_run`
Audit log for discovery. One row per Google Places API call we made. Records what geography we searched, what query we used, how many candidates we got. Used to attribute costs and avoid re-running the same query.

### Why we don't delete anything

Rejected candidates, archived shuls, failed extractions — none of them are deleted. We mark them with a status and keep the row. Two reasons:
1. Future discovery runs can check "have we already rejected this place?" to avoid showing junk twice.
2. If we ever want to retrain our AI prompts or build auto-approve heuristics, the history is the dataset.

Storage is cheap; data lost can't come back.

---

## 12. What it costs to run, today and at scale

### Today (~65 shuls in the system)

| Service | Monthly cost |
|---|---|
| Vercel hosting | $0 (hobby plan) |
| Neon database | $0 (free tier) |
| Anthropic AI | ~$3-8 |
| Inngest jobs | $0 (free tier) |
| Browserless renders | $0 (free tier) |
| Google Maps | $0-5 |
| Cloudflare | $0 (free tier) |
| Resend email | $0 (free tier) |
| Domain | ~$1 (annualized) |
| **Total** | **~$5-15 / month** |

### At 500 shuls (rough projection)

Most costs scale with usage, not user count. The main jumps:
- **Vercel** would likely move to the Pro plan ($20/mo) for more function-execution capacity.
- **Anthropic** is the biggest variable. ~$50-100/month at 500 shuls re-scraped weekly. Could be lower if more sites hit the cheap Haiku tier and skip the more expensive Sonnet escalation.
- **Google Maps** would grow with discovery — maybe $20-40/month if we're actively running discovery in new geographies.
- **Database** would stay free until ~10GB of data. We're currently around 10MB. We'd hit the paid tier maybe at 50,000 shuls.

Realistic projection: **~$80-160 / month at 500 shuls**.

### At 5,000 shuls

The expensive thing is the AI. At weekly extraction across 5,000 shuls, AI costs could be $500-1,000/month. Other services would still be cheap. **Total ~$700-1,300 / month**.

This is well within the realm where the project could sustain itself on a single donor or a sponsorship deal. It's nowhere near needing a serious revenue model.

---

## 13. What can go wrong and how we handle it

### A shul changes their website and extraction breaks
- The Saturday-night scrape detects it (extraction returns 0 rules, or rule count drops by more than 50%).
- The shul is flagged for admin review (not silently broken — visible in your queue).
- The previous-known-good rules stay in place; the new (broken) extraction is held in a separate "pending" state.

### Cloudflare's IPs get blocked too
The anti-bot fallback (section 7) is the second line of defense. If those IPs ever get blocked, we'd need a third tier — possibly Browserless with residential proxy support, or per-CMS-specific scrapers (a Chabad.org API client, etc.). Tracked in the IDEAS.md backlog.

### An AI returns garbage
We validate every AI response against a strict schema (Zod schema in the code). If the AI returns invalid JSON or a malformed rule, we either escalate to a smarter AI model or fail loud — never silently store garbage.

### Someone forwards spam to submit@tfila.co
The AI is told to look for minyan times. Anything else returns low confidence and gets ignored. Spam doesn't pollute the database.

### A discovery API key gets leaked
The Google API key is locked down with **API restrictions** — it can only be used to call the specific Google APIs we use, only from approved server IPs. A leaked key would burn $200 of free tier before we noticed; no real damage.

### The database loses data
Neon takes automated daily backups. We can restore to any point in the last 7 days for free. For longer retention, the paid tier supports point-in-time restore over 30 days.

### Someone reports their shul has wrong times
The /admin/shul/[slug] page has all the tools: edit URL, manually re-extract, mark unsupported, archive the shul. There's no "delete" in the user-facing sense — bad data gets marked rather than removed, so we have a record of what was once thought correct.

---

## 14. What we deliberately don't do

- **No native iOS/Android apps.** The website is a Progressive Web App — installable on a phone like an app, but built once and works everywhere. Native apps would be 5× the engineering work for marginal benefit.
- **No user accounts.** No registration, no password. The site uses your phone's location, remembers it locally, and that's all.
- **No shul logins.** Shuls don't manage their listing. We pull from the source they already publish (website or email).
- **No comments / reviews / social features.** We're a directory, not a social network.
- **No ads.** Not now, probably not ever.
- **No paid features.** Free for daveners, end of story.
- **No historical archive of past times.** We track the current schedule, not what it was three months ago.
- **No coverage of non-Orthodox-pattern features.** We accept Conservative and Reform shul data via the same pipeline, but we don't build features specifically for their patterns.
- **No replacement for actual halachic guidance.** We list minyan times. We don't tell you which minyan to attend, which nusach is right for you, or anything else with halachic implications.

---

## 15. What's coming next

In rough priority order:

1. **Admin flow simplification.** Currently the admin work spans several pages that grew up independently. A unified pipeline view that shows each shul's stage and the single next action would cut friction by half. Active concern as of end of 2026-05-14.
2. **Continue discovery in dense Orthodox geographies.** Crown Heights is seeded. Lakewood, Boro Park, Flatbush, Williamsburg, Five Towns are queued. Each ~10 minutes of admin click-through.
3. **Sub-region tiling for very dense neighborhoods.** Google Places caps at 20 results per query; Lakewood has 200+ shuls. We need to split dense targets into smaller bounding boxes.
4. **Auto-approve heuristic** for unambiguous candidates (clearly a synagogue, has a website, name matches a regex) to reduce per-shul clicking.
5. **Directory crawl scrapers** — Chabad.org/centers, OU shulfinder, local Vaad lists — as a complement to Places discovery.
6. **Phase 2 features** (deferred, but on the books): nusach filters, Torah-study sidebar (parsha/daf yomi with Sefaria links), multi-day Shabbos planning view, walking directions.

---

## 16. Plain → technical glossary

If you're ever in a vendor's dashboard or searching code and want to map plain-English back to the real name, this is the cheat sheet.

| Plain English | Technical name | Lives in |
|---|---|---|
| The website | Next.js App | `app/` |
| Where the website is hosted | Vercel | external |
| The database | Neon Postgres | external |
| How code talks to the database | Drizzle ORM | `db/` |
| The geography add-on | PostGIS | inside the database |
| Background-job manager | Inngest | external + `lib/inngest/` |
| AI we use for extraction | Anthropic (Claude API) | external + `lib/llm/` |
| Remote-Chrome rendering service | Browserless | external + `lib/scrapers/render.ts` |
| Google's address-to-coordinates | Google Geocoding API | external + `lib/geocoding.ts` |
| Google's "find a synagogue" search | Google Places Text Search v1 | external + `lib/geocoding.ts` |
| Where emails to submit@tfila.co arrive | Cloudflare Email Routing | external |
| Small program running on Cloudflare | Cloudflare Worker | `cloudflare-worker/` |
| The anti-bot bypass proxy | The `fetch()` handler in the same Worker | `cloudflare-worker/src/index.ts` |
| Outbound email service | Resend | external + `lib/email.ts` |
| Domain registration | Porkbun | external |
| Source control | GitHub | external |
| Visual styling | Tailwind v4 | `app/globals.css` |
| Brand color | amber-800 (Tailwind palette) | n/a |
| Image processing for logo | Sharp | `scripts/build-logo-assets.mjs` |
| The 4-step extract-from-site logic | "the cascade" | `lib/llm/cascade.ts` |
| Finding the right page within a site | "schedule-page resolver" | `lib/discovery/find-schedule-page.ts` |
| Google-Places-seeded shul discovery | "the discovery system" | `lib/discovery/`, `data/discovery-targets.json` |
| Admin login | Magic link (HMAC-signed) | `lib/auth.ts` |
| Audit log of weekly re-checks | `scrape_run` table | inside the database |
| Audit log of Google Places queries | `discovery_run` table | inside the database |
| Holding pen for discovered shuls | `shul_candidate` table | inside the database |
| Each shul's published listing | `shul` table | inside the database |
| Each individual time pattern | `minyan_rule` table | inside the database |
| Each source feeding a shul's info | `data_source` table | inside the database |

---

*This document is a snapshot as of 2026-05-14. The architecture and dependencies may evolve; check `PROGRESS.md` and `CHANGELOG.md` for changes since.*
