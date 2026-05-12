import Link from "next/link";
import { ChangeLocationButton } from "./ChangeLocationButton";
import { RadiusSelector } from "./RadiusSelector";

interface Props {
  placeName: string | null;
  /** Used as fallback when place name is unavailable. */
  lat: number;
  lng: number;
  radiusMiles: number;
}

/**
 * Sticky header for the post-location feed. Keeps the three site
 * jobs reachable on every scroll: place chip (Find context), search
 * icon (Look up), and Add link (Submit).
 */
export function FeedHeader({ placeName, lat, lng, radiusMiles }: Props) {
  const placeLabel =
    placeName ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`;

  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-neutral-200 bg-white/95 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="shrink-0">
          <span className="text-base font-semibold tracking-tight text-neutral-900">
            tfila<span className="text-amber-700">.</span>co
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-2 text-xs">
          <Link
            href="/find"
            aria-label="Look up a shul"
            title="Look up a shul by name"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-100"
          >
            🔍
          </Link>
          <Link
            href="/submit"
            className="hidden h-7 items-center rounded-full border border-neutral-300 px-2.5 text-neutral-700 hover:bg-neutral-100 sm:flex"
          >
            + Add shul
          </Link>
          <Link
            href="/submit"
            aria-label="Add a shul"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-100 sm:hidden"
          >
            +
          </Link>
        </div>
      </div>

      {/* Place + radius row */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-neutral-600">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-neutral-500">Near</span>
          <span className="truncate font-medium text-neutral-900">
            {placeLabel}
          </span>
          <ChangeLocationButton />
        </div>
        <RadiusSelector current={radiusMiles} />
      </div>
    </header>
  );
}
