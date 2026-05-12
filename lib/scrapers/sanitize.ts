/**
 * Strip HTML bloat that has no signal for the LLM extractor.
 *
 * WordPress / Divi / Wix pages routinely have 80-90% of their byte count
 * in inline CSS, font-face declarations, and minified JS. agudahsouth.com
 * is a real example: 180KB total, schedule starts at byte ~155K, every
 * one of those leading bytes is boilerplate. Stripping `<script>`,
 * `<style>`, `<noscript>`, `<svg>`, and HTML comments typically cuts the
 * page to 20-30KB — well inside our token budget — without losing any
 * minyan content.
 *
 * Conservative on purpose: we don't strip `display:none` blocks (some
 * sites use them for legitimate collapsed content), tables, headings,
 * or class/id attributes (the LLM uses class hints like
 * `widget_text widget_minyan_times` to disambiguate).
 */
export function sanitizeHtmlForLLM(html: string): string {
  let out = html;

  // Remove block-level tags with their bodies. Flags: g (global), i (case-insensitive), s (. matches newlines).
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "");
  out = out.replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, "");
  out = out.replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, "");

  // HTML comments — including conditional IE comments.
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Self-closing / void elements that never carry minyan content.
  out = out.replace(/<link\b[^>]*\/?>/gi, "");
  out = out.replace(/<meta\b[^>]*\/?>/gi, "");
  out = out.replace(/<img\b[^>]*\/?>/gi, "");
  out = out.replace(/<source\b[^>]*\/?>/gi, "");
  out = out.replace(/<input\b[^>]*\/?>/gi, "");

  // Collapse excessive whitespace — leaves single newlines + paragraph breaks intact.
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/(\s*\n\s*){2,}/g, "\n\n");

  return out.trim();
}
