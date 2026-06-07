#!/usr/bin/env node
// HTTP smoke test for the public surface.
//
// Guards the exact class of bug that took the site down (the geo-tz home-feed
// 500, plan C3): it asserts the landing AND the LOCATED feed return a non-error
// status — including a Jerusalem coordinate whose timezone needs geo-tz polygon
// precision, the case that was 500-ing in production. Run against any deploy:
//
//   node scripts/smoke.mjs https://<preview-or-prod-url>
//
// Defaults to production. Exits non-zero if any check fails, so it can gate a
// deploy / run in CI.

const base = (process.argv[2] || process.env.SMOKE_URL || "https://tfila.co").replace(/\/$/, "");

const checks = [
  ["landing", "/"],
  ["located feed (Toronto)", "/?lat=43.6657&lng=-79.3936&radius=2"],
  ["located feed (Jerusalem — geo-tz polygon case)", "/?lat=31.778&lng=35.2354&via=address&q=Jerusalem"],
  ["api/health", "/api/health"],
  ["sitemap", "/sitemap.xml"],
  ["robots", "/robots.txt"],
];

let failed = 0;
for (const [name, path] of checks) {
  const url = base + path;
  try {
    const res = await fetch(url, { headers: { "user-agent": "tfila-smoke/1" } });
    const ok = res.status >= 200 && res.status < 400;
    console.log(`${ok ? "PASS" : "FAIL"}  ${String(res.status).padEnd(3)}  ${name}  ${path}`);
    if (!ok) failed++;
  } catch (err) {
    console.log(`FAIL  ERR  ${name}  ${path}  ${err?.message ?? err}`);
    failed++;
  }
}

console.log(
  `\n${failed === 0 ? "✓ all smoke checks passed" : `✗ ${failed} smoke check(s) failed`} against ${base}`,
);
process.exit(failed === 0 ? 0 : 1);
