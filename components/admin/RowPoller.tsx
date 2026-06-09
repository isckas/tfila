"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 5000;
const MAX_MS = 4 * 60 * 1000; // give up after ~4 min → manual refresh

interface StatePayload {
  state: string;
  pendingDataSourceId: number | null;
}

/**
 * Auto-refresh for an in-flight inbox row. Mounts only on a row whose
 * extraction is running (first extraction, or a just-queued re-extract). Polls
 * GET /api/admin/shul/[id]/state every few seconds; the moment the derived
 * state OR the pending source id differs from what it mounted with, the
 * extraction has landed → router.refresh() re-renders the server row (which is
 * then no longer in-flight, so this unmounts). Caps at ~4 min → a manual
 * "Refresh" fallback so a silently-failed extraction never spins forever.
 *
 * Only ever runs for the handful of rows actively extracting (single-admin
 * tool), and the endpoint is one indexed aggregate — no scale concern.
 */
export function RowPoller({
  shulId,
  initialState,
  initialPendingId,
}: {
  shulId: number;
  initialState: string;
  initialPendingId: number | null;
}) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (cancelled) return;
      if (Date.now() - startRef.current > MAX_MS) {
        setGaveUp(true);
        return;
      }
      try {
        const res = await fetch(`/api/admin/shul/${shulId}/state`, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as StatePayload;
          if (
            data.state !== initialState ||
            data.pendingDataSourceId !== initialPendingId
          ) {
            if (!cancelled) router.refresh();
            return; // landed — refresh remounts the (now-terminal) row
          }
        }
      } catch {
        // transient network error — keep polling until the cap
      }
      timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shulId, initialState, initialPendingId, router]);

  if (gaveUp) {
    return (
      <button
        type="button"
        onClick={() => router.refresh()}
        className="mt-1 inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200"
      >
        ⟳ Still working — refresh
      </button>
    );
  }
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      Extracting… auto-refreshes when it lands
    </span>
  );
}
