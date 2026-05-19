# First Users Test Plan

The 1-2 week window when 3-5 friends actually try tfila.co for the first time. The Phase-1 "3-5 real daveners successfully used it" criterion lives or dies here.

This doc exists so the test doesn't produce *vibes*. By the end of week 2 the question "iterate / build feature X / scrap" needs a real answer.

---

## Cohort (fill in before sending the URL)

Pick 3-5 people with deliberate diversity. Diversity matters more than count — five Brooklyn weekday-Shacharis daveners surface the same feedback as one of them.

| # | Initials | Where they live | Phone OS | Davening pattern | Status |
|---|---|---|---|---|---|
| 1 | _____ | _____ | iOS / Android | weekday Shacharis / Mincha-Maariv / Shabbos only / mostly travel | invited / using / dropped |
| 2 | _____ | _____ | _____ | _____ | _____ |
| 3 | _____ | _____ | _____ | _____ | _____ |
| 4 | _____ | _____ | _____ | _____ | _____ |
| 5 | _____ | _____ | _____ | _____ | _____ |

**Target diversity**:
- At least one weekday-only davener (the urgent "next minyan" use case)
- At least one traveler / multi-city davener (the planning use case)
- At least one user not in your immediate geography (catches "only works in Brooklyn" bugs)
- Mix of iOS + Android (PWA install behaves differently)
- At least one user who'd never voluntarily click "Add a shul" (only-consumer)

---

## The share message

One WhatsApp/iMessage paragraph. Short, low-pressure, asks for honesty over politeness. Tweak the URL fragment per person if you want.

> Trying something out — a no-login site that just shows you the next minyan near you. Looking for 3 minutes of honest feedback this week, especially if it broke. https://tfila.co
>
> If you do try it: tell me what you tried to do and whether it worked. That's it.

Avoid: feature lists, marketing language, "be gentle." Don't pre-frame the experience — they'll try it whatever you say.

---

## 3 questions to ask each person (after they've tried it)

Same three, every person. Resist the urge to add follow-ups in the moment — let the answers speak.

1. **What did you try to do on the site?**
   - Catches: are users trying the use cases you thought you built? Or are they bouncing off the wrong page entirely?
2. **Did it work?**
   - Binary first, then pull the thread on "no" or "kind of."
3. **Would you use it again?**
   - The ground truth question. "I'd use it Friday afternoon when I'm running late" is gold. "It's cool" is a fail.

**What NOT to ask**: "What would you add?" / "Did you like the design?" / "Was the location detection good?" — leading questions that produce feel-good fiction.

---

## Signals to collect

Two streams, both passive after the share message goes out.

### Quantitative (Vercel Analytics dashboard)
- Pageviews from non-Isaac IPs in the test window
- Top routes (`/`, `/shul/[slug]`, `/submit`, `/find`) — distribution tells you what the cohort actually used
- Session count + bounce rate
- Mobile vs desktop split

### Qualitative (manual notes)
- One short note per conversation. What they tried, whether it worked, would they use it again, anything they volunteered unprompted
- Keep them in `docs/FIRST-USERS-NOTES.md` (create as you go) — terse bullet lines, dated

---

## Cadence

- **Day 0**: send the share message to everyone in the cohort the same day
- **Days 1-7**: don't iterate. Resist the impulse to fix the first complaint that lands. Let signal accumulate. The first piece of feedback is usually idiosyncratic.
- **Day 7**: collect notes from anyone who tried it. Tally analytics. Don't follow up with users who went silent — silence is data too.
- **Days 8-14**: ship at most one or two iterations IF the same gap shows up across ≥2 users. Otherwise hold.
- **Day 14**: decide.

---

## Decision criteria (pre-written so it doesn't come from emotion)

After 2 weeks, one of three:

### A. Iterate on what's there
**Trigger**: ≥3 of 5 users said "yes I'd use it again" + named a real future moment ("Friday running late," "next time I'm in Miami"). Specific complaints concentrate on 1-2 things, not 7.
**Action**: ship those 1-2 things. Run another 2-week test with the same cohort + a few new users.

### B. Build feature X
**Trigger**: ≥2 of 5 users described the same MISSING capability that isn't on the page — e.g. "I wanted to know about Yom Tov schedules in advance," "I wanted to share a shul to WhatsApp." Pattern is the same gap, not just adjacent preferences.
**Action**: pick the most-requested missing capability, build it, re-test.

### C. Scrap and rethink the wedge
**Trigger**: ≥3 of 5 users said "no, I don't think I'd use it again" with reasons that aren't fixable by small iterations — e.g. "the times feel untrustworthy," "I just use Google," "I don't have a problem this solves."
**Action**: don't iterate on UX. Step back to scoping. Re-derive the killer use case from the friction the cohort actually felt.

### What NOT to count as a decision

- "I'd use it" without a specific moment named (= social politeness)
- One person being very enthusiastic (= n=1)
- "It's a nice idea" (= the polite version of "no")
- Zero feedback at all (= the cohort got the message, opened nothing, kept scrolling. Pretend they said "no.")

---

## Pre-test checklist (before sending the share message)

Make sure these are landed on prod, in this order:

- [ ] Step 1: `EXTRACTION_PIPELINE_V2=true` flag is live (done 2026-05-18)
- [ ] Launch-prep batch deployed (Open Graph metadata, sitemap, robots, tap targets, special-schedule labels, dev-comment stripped)
- [ ] Vercel Analytics confirmed receiving pageviews
- [ ] Sentry receiving a deliberate test error (so we know error capture is live)
- [ ] UptimeRobot monitor pointed at `/api/health`
- [ ] PWA installable on at least one iPhone you have access to (Add to Home Screen works)
- [ ] Travel mode date picker visible on the feed
- [ ] Tefillah filter chips visible
- [ ] In-progress live pill shows up when a minyan is actively running (test by viewing the site within 30 min after any morning Shacharis ends)
- [ ] Freshness badge ("Verified Nd ago") visible on shul cards

If any of the above is missing, hold the share message — the test isn't testing what we think it is.

---

## After the test

Update this file with:
- The final cohort (names + outcomes)
- The decision (A / B / C)
- The reasoning behind the decision
- What the next 2-week test looks like (if applicable)

The point is to not have to re-derive this thinking the second time around.
