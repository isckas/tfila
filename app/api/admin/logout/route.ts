import { NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/auth";

export async function POST(req: Request) {
  await clearAdminSession();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
