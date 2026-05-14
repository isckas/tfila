// Generates the Next.js icon + apple-icon + opengraph-image PNG variants
// from the source tfila-b.png logo at the repo root.
//
// Run once after editing the source logo:
//   node scripts/build-logo-assets.mjs
//
// Outputs (next 16 conventions):
//   - app/icon.png             512x512 icon-only (pin + siddur, no wordmark)
//   - app/apple-icon.png       180x180 icon-only with rounded corner padding
//   - app/opengraph-image.png  1200x630 social-share card

import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SOURCE = "tfila-b.png";
const STONE_50 = { r: 250, g: 250, b: 249, alpha: 1 }; // tailwind stone-50
const AMBER_800 = "#92400e";
const CHARCOAL = "#171717";

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

async function buildIconOnly(size, outPath) {
  ensureDir(outPath);
  // Source layout: pin occupies roughly the top 73% of the 2048x2048 canvas,
  // wordmark below it. Two-pass to avoid sharp's chain "bad extract area"
  // error: (1) extract the top 75% as a fresh PNG buffer; (2) trim
  // whitespace and resize-pad in a second pass.
  // Crop ends at y=1400 — pin tail finishes around y=1430, but we cut
  // slightly above to guarantee no wordmark glyphs leak through. Trim
  // then recovers the actual bounding box, so the slight crop loss
  // (the very tip of the pin) is invisible in the final centered icon.
  const topRegion = await sharp(SOURCE)
    .extract({ left: 0, top: 0, width: 2048, height: 1400 })
    .png()
    .toBuffer();
  await sharp(topRegion)
    .trim({ background: "#ffffff", threshold: 10 })
    .resize({
      width: size,
      height: size,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${size}x${size})`);
}

async function buildOgImage(outPath) {
  ensureDir(outPath);
  // 1200x630 card: full logo (pin + wordmark) centered on stone-50 with
  // tagline below. Composite via SVG overlay because sharp can't render
  // arbitrary text without a TTF file installed.
  const W = 1200;
  const H = 630;

  // Trim the source to the bounding box, scale to fit ~60% of card height,
  // composite at center-top.
  const trimmed = await sharp(SOURCE)
    .trim({ background: "#ffffff", threshold: 10 })
    .toBuffer();
  const logo = await sharp(trimmed)
    .resize({ height: 420, fit: "contain", background: { r: 250, g: 250, b: 249, alpha: 1 } })
    .toBuffer();
  const logoMeta = await sharp(logo).metadata();

  // Tagline SVG underneath
  const taglineSvg = Buffer.from(`
    <svg width="${W}" height="80" xmlns="http://www.w3.org/2000/svg">
      <style>
        .t { font: 600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; fill: ${CHARCOAL}; }
      </style>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="t">
        Find the next minyan near you
      </text>
    </svg>
  `);

  await sharp({
    create: { width: W, height: H, channels: 4, background: STONE_50 },
  })
    .composite([
      {
        input: logo,
        left: Math.round((W - logoMeta.width) / 2),
        top: 60,
      },
      {
        input: taglineSvg,
        left: 0,
        top: 500,
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${W}x${H})`);
}

async function buildLegacyFavicon(outPath) {
  ensureDir(outPath);
  // Static fallback for /favicon.ico — covers link unfurlers and older
  // clients that hardcode the legacy path instead of reading the <link
  // rel="icon"> tag. Sharp can't write true multi-resolution ICO (libvips
  // lacks the encoder), so we emit a 32x32 PNG with .ico extension.
  // Browsers accept this magic-byte mismatch on the legacy favicon path.
  await sharp("app/icon.png")
    .resize(32, 32, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (32x32 png-as-ico)`);
}

async function main() {
  // Sanity-check source exists + readable
  readFileSync(SOURCE);

  await buildIconOnly(512, "app/icon.png");
  await buildIconOnly(180, "app/apple-icon.png");
  // public/tfila-icon.png is the in-page <Image> source for the home
  // hero. app/icon.png is special (Next 16 transforms it into <link
  // rel="icon">), so it can't be referenced as /icon.png directly —
  // we need this static copy under /public for the page to import.
  await buildIconOnly(512, "public/tfila-icon.png");
  // public/tfila-full.png is the full logo (pin + "tfila.co" wordmark
  // underneath) — used by the home-page hero card so the wordmark is
  // visible without needing live text. Trim whitespace, resize to 512
  // on the longest side keeping aspect ratio.
  await sharp(SOURCE)
    .trim({ background: "#ffffff", threshold: 10 })
    .resize({ width: 512, fit: "inside", withoutEnlargement: false })
    .png({ compressionLevel: 9 })
    .toFile("public/tfila-full.png");
  console.log(`✓ public/tfila-full.png (full logo with wordmark)`);
  await buildOgImage("app/opengraph-image.png");
  await buildLegacyFavicon("public/favicon.ico");

  console.log("\nDone. Next 16 auto-wires icon.png/apple-icon.png/opengraph-image.png");
  console.log("from app/. No layout.tsx changes needed for those.");
}

main().catch((e) => {
  console.error("build-logo-assets failed:", e);
  process.exit(1);
});
