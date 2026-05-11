export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function nameFromTitle(title: string): string {
  if (!title) return "";
  let cleaned = title.split(/[|•·–—•]/)[0].trim();
  cleaned = cleaned.replace(/\s*-\s*Home\b.*/i, "");
  cleaned = cleaned.replace(/\s*\|\s*ShulCloud.*/i, "");
  cleaned = cleaned.replace(/^Welcome to /i, "");
  return cleaned.trim();
}
