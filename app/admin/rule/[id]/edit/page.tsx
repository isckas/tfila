import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { minyanRule, shul, dataSource, type MinyanTime } from "@/db/schema";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

const TEFILLAH_OPTIONS = [
  "shacharis",
  "mincha",
  "maariv",
  "selichos",
  "neilah",
  "other",
] as const;

const SPECIAL_SCHEDULE_OPTIONS = [
  "regular",
  "yom_tov",
  "three_weeks",
  "aseres_yemei_teshuvah",
  "fast_day",
  "rosh_chodesh",
  "ad_hoc",
] as const;

const ANCHOR_OPTIONS = [
  "shkia",
  "tzeis_72",
  "tzeis_42",
  "alos",
  "netz",
  "misheyakir",
  "sof_zman_tefillah_mga",
  "sof_zman_tefillah_gra",
  "sof_zman_shma_mga",
  "sof_zman_shma_gra",
  "chatzos",
  "mincha_gedolah",
  "plag_mincha",
  "candle_lighting",
] as const;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Shabbos"];

export default async function EditRulePage({ params }: PageProps) {
  const { id } = await params;
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) notFound();

  const rows = await db
    .select({
      id: minyanRule.id,
      shulId: minyanRule.shulId,
      shulSlug: shul.slug,
      shulName: shul.name,
      dataSourceId: minyanRule.dataSourceId,
      tefillah: minyanRule.tefillah,
      tefillahLabel: minyanRule.tefillahLabel,
      daysOfWeek: minyanRule.daysOfWeek,
      time: minyanRule.time,
      validFrom: minyanRule.validFrom,
      validTo: minyanRule.validTo,
      specialScheduleKind: minyanRule.specialScheduleKind,
      nusach: minyanRule.nusach,
      notes: minyanRule.notes,
    })
    .from(minyanRule)
    .innerJoin(shul, eq(shul.id, minyanRule.shulId))
    .where(eq(minyanRule.id, ruleId))
    .limit(1);
  const r = rows[0];
  if (!r) notFound();

  const t = r.time as MinyanTime;
  const isFixed = t.kind === "fixed";
  const isZmanim = t.kind === "zmanim";
  const days = new Set(r.daysOfWeek ?? []);
  const backLink = r.dataSourceId
    ? `/admin/data-source/${r.dataSourceId}`
    : `/admin/shul/${r.shulSlug}`;

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <Link href={backLink} className="text-xs text-neutral-500 hover:underline">
        ← back
      </Link>

      <h1 className="mt-3 text-2xl font-semibold">Edit rule {r.id}</h1>
      <p className="text-sm text-neutral-600">
        {r.shulName} ·{" "}
        <Link href={`/admin/shul/${r.shulSlug}`} className="underline-offset-2 hover:underline">
          shul page
        </Link>
      </p>

      <form
        method="post"
        action={`/api/admin/rule/${r.id}/edit?dsId=${r.dataSourceId ?? ""}`}
        className="mt-6 space-y-5 rounded-xl border border-neutral-200 bg-white p-5"
      >
        {/* ── Tefillah ─────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Tefillah</span>
            <select
              name="tefillah"
              defaultValue={r.tefillah}
              required
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            >
              {TEFILLAH_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Tefillah label (if other)
            </span>
            <input
              type="text"
              name="tefillahLabel"
              defaultValue={r.tefillahLabel ?? ""}
              placeholder="e.g. Vasikin Shacharis"
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </label>
        </div>

        {/* ── Days of week ─────────────────────────────── */}
        <div>
          <span className="text-xs font-medium text-neutral-600">Days of week</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {DAY_NAMES.map((label, idx) => (
              <label key={idx} className="flex items-center gap-1 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  name="daysOfWeek"
                  value={String(idx)}
                  defaultChecked={days.has(idx)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* ── Time ─────────────────────────────────────── */}
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-xs font-medium text-neutral-600">Time</div>

          <div className="mt-2 flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="timeKind"
                value="fixed"
                defaultChecked={isFixed}
                required
              />
              Fixed clock
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="timeKind"
                value="zmanim"
                defaultChecked={isZmanim}
              />
              Zmanim-relative
            </label>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-neutral-600">
                Fixed clock (HH:MM, 24-hour)
              </span>
              <input
                type="text"
                name="clock"
                defaultValue={isFixed ? t.clock : ""}
                pattern="^\d{1,2}:\d{2}$"
                placeholder="07:00"
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-neutral-600">Anchor</span>
                <select
                  name="anchor"
                  defaultValue={isZmanim ? t.anchor : "shkia"}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
                >
                  {ANCHOR_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-neutral-600">Offset (min)</span>
                <input
                  type="number"
                  name="offsetMin"
                  defaultValue={isZmanim ? t.offsetMin : 0}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
                />
              </label>
            </div>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Negative offset = before (e.g. -18 min before shkia for Mincha).
          </p>
        </div>

        {/* ── Special schedule ─────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Special schedule kind
            </span>
            <select
              name="specialScheduleKind"
              defaultValue={r.specialScheduleKind}
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            >
              {SPECIAL_SCHEDULE_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Valid from
            </span>
            <input
              type="date"
              name="validFrom"
              defaultValue={r.validFrom ?? ""}
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Valid to</span>
            <input
              type="date"
              name="validTo"
              defaultValue={r.validTo ?? ""}
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </label>
        </div>

        {/* ── Nusach + notes ───────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Nusach (override)</span>
            <input
              type="text"
              name="nusach"
              defaultValue={r.nusach ?? ""}
              placeholder="Ashkenaz / Sefard / etc"
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Notes</span>
            <input
              type="text"
              name="notes"
              defaultValue={r.notes ?? ""}
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Save
          </button>
          <Link
            href={backLink}
            className="rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
