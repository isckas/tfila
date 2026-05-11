// Compute the major zmanim for a single (location, date) pair.
// Used for the home-page zmanim strip + future /zmanim page.

import { Zmanim, GeoLocation } from "@hebcal/core";
import type { ShulGeo } from "./resolve";

export interface ZmanimSnapshot {
  date: Date;
  /** Each value is null if @hebcal/core can't compute it for this location. */
  alos: Date | null;
  netz: Date | null;
  sofZmanShmaGra: Date | null;
  sofZmanShmaMga: Date | null;
  sofZmanTefillahGra: Date | null;
  sofZmanTefillahMga: Date | null;
  chatzos: Date | null;
  minchaGedolah: Date | null;
  plag: Date | null;
  shkia: Date | null;
  tzeis72: Date | null;
  candleLighting: Date | null;
  havdalah: Date | null;
}

function tryOrNull<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function computeZmanimStrip(geo: ShulGeo, date: Date): ZmanimSnapshot {
  const tz = geo.timezone ?? "America/New_York";
  const gloc = new GeoLocation(null, geo.lat, geo.lng, 0, tz);
  const z = new Zmanim(gloc, date, false);

  return {
    date,
    alos: tryOrNull(() => z.alotHaShachar()),
    netz: tryOrNull(() => z.sunrise()),
    sofZmanShmaGra: tryOrNull(() => z.sofZmanShma()),
    sofZmanShmaMga: tryOrNull(() => z.sofZmanShmaMGA()),
    sofZmanTefillahGra: tryOrNull(() => z.sofZmanTfilla()),
    sofZmanTefillahMga: tryOrNull(() => z.sofZmanTfillaMGA()),
    chatzos: tryOrNull(() => z.chatzot()),
    minchaGedolah: tryOrNull(() => z.minchaGedola()),
    plag: tryOrNull(() => z.plagHaMincha()),
    shkia: tryOrNull(() => z.sunset()),
    tzeis72: tryOrNull(() => z.sunsetOffset(72, false)),
    candleLighting: tryOrNull(() => z.sunsetOffset(-18, false)),
    havdalah: tryOrNull(() => z.tzeit(8.5)),
  };
}
