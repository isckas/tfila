// Find the ORIGINAL sender of a forwarded email by scanning the body for
// "From:" lines that mail clients prepend during forwarding.
//
// Gmail format:
//   ---------- Forwarded message ----------
//   From: Sender Name <sender@example.com>
//   Date: Mon, May 11, 2026 at 7:42 PM
//   Subject: Weekly Schedule
//
// Outlook format:
//   ________________________________
//   From: Sender Name <sender@example.com>
//   Sent: Monday, May 11, 2026 7:42 PM
//
// Apple Mail format:
//   Begin forwarded message:
//   From: Sender Name <sender@example.com>
//   Date: May 11, 2026 at 7:42 PM
//   Subject: Weekly Schedule
//
// Yahoo / generic:
//   ----- Forwarded Message -----
//   From: sender@example.com
//
// We're forgiving — first valid email address after a "From:" label wins.

export interface OriginalSender {
  /** The bare email address, lowercased. */
  email: string;
  /** Display name if visible, otherwise null. */
  name: string | null;
}

const FROM_LINE_RE = /^From:\s*(.+)$/im;
const ALL_FROM_LINES_RE = /^From:\s*(.+)$/gim;
const NAME_AND_EMAIL_RE = /^\s*"?([^"<]+?)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/;
const BARE_EMAIL_RE = /^\s*([^<>\s]+@[^<>\s]+)\s*$/;
const FORWARD_MARKER_RE =
  /(?:-+\s*Forwarded message\s*-+|Begin forwarded message:|-+\s*Forwarded Message\s*-+|________)/i;

/**
 * Returns the LIKELY original sender of a forwarded email body, or null
 * if none can be confidently identified.
 *
 * Strategy: find the first "From: …" line that appears AFTER a known
 * forward marker. Fall back to the first "From: …" line we can parse.
 */
export function extractOriginalSender(plainBody: string): OriginalSender | null {
  if (!plainBody) return null;

  // Try to find a forward marker first
  const markerMatch = FORWARD_MARKER_RE.exec(plainBody);
  const startIdx = markerMatch ? markerMatch.index : 0;
  const haystack = plainBody.slice(startIdx);

  for (const m of haystack.matchAll(ALL_FROM_LINES_RE)) {
    const line = m[1].trim();
    const parsed = parseFromLine(line);
    if (parsed) return parsed;
  }

  // Fallback: first "From:" line anywhere in the body
  const anyFrom = plainBody.match(FROM_LINE_RE);
  if (anyFrom) {
    const parsed = parseFromLine(anyFrom[1].trim());
    if (parsed) return parsed;
  }
  return null;
}

function parseFromLine(line: string): OriginalSender | null {
  const withName = line.match(NAME_AND_EMAIL_RE);
  if (withName) {
    return {
      name: withName[1].trim() || null,
      email: withName[2].toLowerCase().trim(),
    };
  }
  const bare = line.match(BARE_EMAIL_RE);
  if (bare) {
    return { name: null, email: bare[1].toLowerCase().trim() };
  }
  return null;
}
