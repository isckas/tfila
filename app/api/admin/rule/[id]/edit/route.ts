import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { minyanRule, serializeMinyanTime, type MinyanTime } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";

const VALID_TEFILLAH = new Set([
  "shacharis",
  "mincha",
  "maariv",
  "selichos",
  "neilah",
  "other",
]);
const VALID_SPECIAL = new Set([
  "regular",
  "yom_tov",
  "three_weeks",
  "aseres_yemei_teshuvah",
  "fast_day",
  "rosh_chodesh",
  "ad_hoc",
]);
const VALID_ANCHOR = new Set([
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
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const form = await req.formData();
  const tefillah = (form.get("tefillah") as string) ?? "";
  const tefillahLabel =
    (form.get("tefillahLabel") as string | null)?.trim() || null;
  const specialScheduleKind = (form.get("specialScheduleKind") as string) ?? "regular";
  const timeKind = (form.get("timeKind") as string) ?? "fixed";
  const clock = (form.get("clock") as string | null)?.trim() ?? "";
  const anchor = (form.get("anchor") as string) ?? "";
  const offsetMinRaw = (form.get("offsetMin") as string | null)?.trim() ?? "0";
  const nusach = (form.get("nusach") as string | null)?.trim() || null;
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const validFrom = (form.get("validFrom") as string | null) || null;
  const validTo = (form.get("validTo") as string | null) || null;
  const daysRaw = form.getAll("daysOfWeek").map((v) => Number(v));
  const daysOfWeek = daysRaw.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  if (!VALID_TEFILLAH.has(tefillah)) {
    return NextResponse.json({ error: "invalid tefillah" }, { status: 400 });
  }
  if (!VALID_SPECIAL.has(specialScheduleKind)) {
    return NextResponse.json(
      { error: "invalid specialScheduleKind" },
      { status: 400 },
    );
  }

  let time: MinyanTime;
  if (timeKind === "fixed") {
    if (!/^\d{1,2}:\d{2}$/.test(clock)) {
      return NextResponse.json(
        { error: "clock must be HH:MM" },
        { status: 400 },
      );
    }
    time = { kind: "fixed", clock };
  } else if (timeKind === "zmanim") {
    if (!VALID_ANCHOR.has(anchor)) {
      return NextResponse.json({ error: "invalid anchor" }, { status: 400 });
    }
    const offsetMin = Number(offsetMinRaw);
    if (!Number.isFinite(offsetMin)) {
      return NextResponse.json(
        { error: "offsetMin must be a number" },
        { status: 400 },
      );
    }
    time = {
      kind: "zmanim",
      anchor: anchor as MinyanTime extends { kind: "zmanim"; anchor: infer A } ? A : never,
      offsetMin,
    };
  } else {
    return NextResponse.json({ error: "invalid timeKind" }, { status: 400 });
  }

  await db
    .update(minyanRule)
    .set({
      tefillah: tefillah as never,
      tefillahLabel,
      daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : null,
      time: serializeMinyanTime(time),
      validFrom,
      validTo,
      specialScheduleKind: specialScheduleKind as never,
      nusach,
      notes,
      // Fix EE: mark this row as a manual override so the weekly cron's
      // rule-replacement step (in scrape-one-shul.ts) skips it. Admin edits
      // become durable across re-extractions.
      isManualEdit: true,
      updatedAt: new Date(),
    })
    .where(eq(minyanRule.id, ruleId));

  // Redirect back to wherever the form said (?dsId=) or fall through to shul.
  const url = new URL(req.url);
  const dsId = url.searchParams.get("dsId");
  const target = dsId ? `/admin/data-source/${dsId}` : `/admin/shuls`;
  return NextResponse.redirect(new URL(target, req.url), 303);
}
