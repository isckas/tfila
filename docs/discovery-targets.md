# tfila.co — Discovery Targets

**Purpose:** ranked list of Jewish-dense geographies for seeding shul discovery via Google Places Text Search. Each row has the metadata needed to run a Places query: center coordinates, radius, and recommended text query. A future batch script reads this file to populate the `shul_candidate` table.

**Ranking criterion:** *daveners* — Orthodox + observant Conservative Jews who attend minyanim, NOT raw Jewish population. Boca Raton outranks Lakewood on total Jews but Lakewood has 50× the davener density. The lists below are weighted toward davener density.

**Estimates note:** davener counts are best-effort orders of magnitude from public demographic data (Berman Jewish DataBank, Sergio DellaPergola's annual reports, AJYB, local Vaad estimates, kosher-infrastructure proxies). They are approximate; correct before any downstream code treats them as authoritative.

**Goal:** cover ~80% of daveners in each region with the fewest possible queries. Tier 1 alone typically captures 60-70%; Tier 1 + Tier 2 gets to 85%+.

---

## How to use this file

Each row has:
- **Name** — display name for the candidate batch
- **Daveners (est.)** — rough order of magnitude
- **Center lat/lng** — for the Places `locationBias.circle.center`
- **Radius (m)** — for the Places `locationBias.circle.radius`. Tighter for dense neighborhoods (1500-2500m), looser for whole cities (5000-10000m).
- **Primary query** — what to put in `textQuery`. Default is `"synagogue"`. Some rows use multiple queries (one per major Orthodox sub-population) to maximize recall.

A Places Text Search v1 request for a row looks like:

```http
POST https://places.googleapis.com/v1/places:searchText
X-Goog-Api-Key: $GOOGLE_GEOCODING_API_KEY
X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.location,places.types,places.websiteUri

{
  "textQuery": "synagogue",
  "maxResultCount": 20,
  "locationBias": {
    "circle": {
      "center": { "latitude": <CENTER_LAT>, "longitude": <CENTER_LNG> },
      "radius": <RADIUS_M>
    }
  }
}
```

`maxResultCount: 20` is the Places v1 hard cap. For dense neighborhoods you'll need to either pass multiple query variants (`"synagogue"`, `"shul"`, `"minyan"`, `"yeshiva"`) or subdivide the bounding circle. Dedup downstream via `places.id`.

---

## North America — covers ~80% of NA daveners

### Tier 1 — dense Orthodox cores (cover ~60-70%)

| # | Name | Daveners (est.) | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 1 | Lakewood, NJ | 75,000 | 40.0938, -74.2179 | 7000 | `"synagogue"`, also `"shul"`, `"beis medrash"` |
| 2 | Boro Park, Brooklyn | 80,000 | 40.6325, -73.9928 | 2500 | `"synagogue"`, also `"shul"`, `"shtiebel"` |
| 3 | Flatbush / Midwood, Brooklyn | 80,000 | 40.6190, -73.9580 | 3500 | `"synagogue"`, also `"shul"`, `"sephardic synagogue"` |
| 4 | Williamsburg (South), Brooklyn | 70,000 | 40.7066, -73.9591 | 1800 | `"synagogue"`, also `"shul"`, `"Satmar"` |
| 5 | Crown Heights, Brooklyn | 30,000 | 40.6688, -73.9430 | 1800 | `"synagogue"`, also `"Chabad"`, `"shul"` |
| 6 | Monsey, NY (incl. Spring Valley + Wesley Hills) | 50,000 | 41.1115, -74.0682 | 7000 | `"synagogue"`, also `"shul"`, `"shtiebel"` |
| 7 | Kiryas Joel, NY | 30,000 | 41.3392, -74.1681 | 3000 | `"synagogue"`, also `"Satmar"` |
| 8 | Five Towns, NY (Cedarhurst / Lawrence / Woodmere / Hewlett / Inwood) | 30,000 | 40.6240, -73.7300 | 5000 | `"synagogue"`, also `"shul"` |
| 9 | Far Rockaway / Bayswater, NY | 25,000 | 40.6020, -73.7510 | 4000 | `"synagogue"`, also `"shul"` |
| 10 | Baltimore — Park Heights / Pikesville | 25,000 | 39.3870, -76.7080 | 6000 | `"synagogue"`, also `"shul"` |
| 11 | Passaic / Clifton, NJ | 25,000 | 40.8665, -74.1280 | 5000 | `"synagogue"`, also `"shul"` |
| 12 | Toronto — Bathurst corridor (Forest Hill / Thornhill) | 30,000 | 43.7700, -79.4400 | 9000 | `"synagogue"`, also `"shul"` |
| 13 | Kew Gardens Hills, Queens | 15,000 | 40.7300, -73.8210 | 2000 | `"synagogue"`, also `"shul"` |
| 14 | Teaneck / Bergenfield / New Milford, NJ | 20,000 | 40.8920, -74.0150 | 5500 | `"synagogue"`, also `"shul"` |
| 15 | Upper West Side, Manhattan | 12,000 | 40.7870, -73.9750 | 2000 | `"synagogue"` |

**Tier 1 subtotal: ~597,000 estimated daveners**

### Tier 2 — significant regional centers (adds ~15-20%)

| # | Name | Daveners (est.) | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 16 | Los Angeles — Pico-Robertson / Hancock Park / La Brea | 25,000 | 34.0540, -118.3870 | 5000 | `"synagogue"`, also `"shul"` |
| 17 | New Square, NY | 10,000 | 41.1390, -74.0260 | 1500 | `"synagogue"`, also `"Skver"` |
| 18 | Cleveland — Cleveland Heights / University Heights / Beachwood | 12,000 | 41.4970, -81.5230 | 6000 | `"synagogue"`, also `"shul"` |
| 19 | Chicago — West Rogers Park (Devon) / Skokie | 12,000 | 42.0050, -87.6960 | 5000 | `"synagogue"`, also `"shul"` |
| 20 | Miami — Aventura / Sunny Isles / N. Miami Beach | 12,000 | 25.9560, -80.1390 | 6500 | `"synagogue"`, also `"shul"`, `"Bukharian"` |
| 21 | Miami Beach — Surfside / Bal Harbour | 8,000 | 25.8800, -80.1230 | 3000 | `"synagogue"`, also `"shul"` |
| 22 | Boston — Brookline / Newton | 10,000 | 42.3320, -71.1450 | 5500 | `"synagogue"`, also `"shul"` |
| 23 | Montreal — Côte Saint-Luc / Hampstead / Outremont | 15,000 | 45.4750, -73.6650 | 7000 | `"synagogue"`, also `"shul"` |
| 24 | Atlanta — Toco Hills / Brookhaven | 8,000 | 33.8230, -84.3110 | 5000 | `"synagogue"`, also `"shul"` |
| 25 | Detroit — Oak Park / Southfield / West Bloomfield | 10,000 | 42.4870, -83.2350 | 7000 | `"synagogue"`, also `"shul"` |
| 26 | Pittsburgh — Squirrel Hill | 7,000 | 40.4380, -79.9230 | 3000 | `"synagogue"`, also `"shul"` |
| 27 | Washington Heights, Manhattan | 6,000 | 40.8420, -73.9390 | 1800 | `"synagogue"` |
| 28 | Houston — Meyerland / Bellaire | 6,000 | 29.6800, -95.4630 | 5000 | `"synagogue"`, also `"shul"` |
| 29 | Memphis — East Memphis | 4,000 | 35.1170, -89.8650 | 4000 | `"synagogue"` |
| 30 | St. Louis — University City | 5,000 | 38.6560, -90.3080 | 4000 | `"synagogue"`, also `"shul"` |
| 31 | Philadelphia — Lower Merion (Wynnewood / Bala Cynwyd) | 6,000 | 40.0010, -75.2680 | 5000 | `"synagogue"`, also `"shul"` |
| 32 | Riverdale, Bronx | 6,000 | 40.8950, -73.9080 | 2500 | `"synagogue"`, also `"shul"` |
| 33 | Forest Hills / Rego Park, Queens (Bukharian core) | 8,000 | 40.7180, -73.8470 | 3000 | `"synagogue"`, also `"Bukharian"` |
| 34 | Staten Island — Willowbrook / New Springville | 6,000 | 40.6090, -74.1420 | 4000 | `"synagogue"`, also `"shul"` |
| 35 | Long Beach, NY (West End) | 4,000 | 40.5870, -73.6650 | 3500 | `"synagogue"`, also `"shul"` |
| 36 | West Hempstead / Great Neck, NY | 6,000 | 40.7080, -73.6620 | 4000 | `"synagogue"`, also `"shul"`, `"Persian"` |
| 37 | Phoenix — Scottsdale | 4,000 | 33.5810, -111.9230 | 6000 | `"synagogue"`, also `"shul"` |
| 38 | Seattle — Seward Park | 3,000 | 47.5530, -122.2740 | 3000 | `"synagogue"` |

**Tier 2 subtotal: ~193,000 estimated daveners**

### Tier 1 + Tier 2 total: ~790,000 — covers ~85% of NA daveners

---

## Europe — covers ~80% of European daveners

European Orthodox communities are smaller and more concentrated than NA. ~12 entries cover the bulk.

### Tier 1 — dense Orthodox centers

| # | Name | Daveners (est.) | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 1 | London — Stamford Hill (Chassidish) | 35,000 | 51.5650, -0.0750 | 2500 | `"synagogue"`, also `"shul"`, `"shtiebel"` |
| 2 | London — Golders Green / Hendon (Litvish + MO) | 25,000 | 51.5790, -0.2010 | 3500 | `"synagogue"`, also `"shul"` |
| 3 | Manchester — Broughton Park / Salford | 12,000 | 53.5050, -2.2680 | 3500 | `"synagogue"`, also `"shul"` |
| 4 | Antwerp, Belgium | 18,000 | 51.2120, 4.4170 | 3000 | `"synagogue"`, also `"shul"` |
| 5 | Paris — 19th arrondissement / Sarcelles | 15,000 | 48.8900, 2.3870 | 5000 | `"synagogue"` |
| 6 | London — Edgware / Borehamwood / Bushey | 10,000 | 51.6160, -0.2750 | 6000 | `"synagogue"`, also `"shul"` |
| 7 | Marseille, France | 10,000 | 43.2950, 5.3810 | 7000 | `"synagogue"` |
| 8 | Strasbourg, France | 5,000 | 48.5860, 7.7490 | 5000 | `"synagogue"` |

### Tier 2 — smaller but established

| # | Name | Daveners (est.) | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 9 | Vienna — 2nd district (Leopoldstadt) | 4,000 | 48.2200, 16.3820 | 3000 | `"synagogue"` |
| 10 | Amsterdam — Buitenveldert / Amstelveen | 3,000 | 52.3320, 4.8650 | 4000 | `"synagogue"` |
| 11 | Zurich — Wiedikon / Enge | 3,000 | 47.3680, 8.5230 | 4000 | `"synagogue"` |
| 12 | Frankfurt am Main | 3,000 | 50.1170, 8.6810 | 6000 | `"synagogue"` |
| 13 | Berlin — Charlottenburg / Mitte | 3,000 | 52.5070, 13.3320 | 8000 | `"synagogue"` |
| 14 | Budapest — 7th district | 3,000 | 47.4990, 19.0680 | 3000 | `"synagogue"` |
| 15 | Gibraltar | 1,500 | 36.1410, -5.3530 | 2500 | `"synagogue"` |

**Total: ~150,000 estimated daveners**

---

## Travel destinations — popular Jewish-traveler spots

Less about resident density, more about "where do daveners visit and want minyan info." Vacation, business, simcha, religious pilgrimage.

### Israel (always seasonal-peak — Pesach, Sukkos, summer)

| # | Name | Notes | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 1 | Jerusalem — Old City + Kotel area | Pilgrimage destination | 31.7760, 35.2350 | 1500 | `"בית כנסת"`, also `"synagogue"` |
| 2 | Jerusalem — Center / Geula / Mea Shearim | Chareidi core | 31.7870, 35.2200 | 2500 | `"בית כנסת"`, also `"shul"` |
| 3 | Jerusalem — Har Nof / Bayit Vegan | Litvish | 31.7770, 35.1810 | 3000 | `"בית כנסת"` |
| 4 | Jerusalem — Ramot / Sanhedria | Chareidi suburbs | 31.8160, 35.2050 | 4000 | `"בית כנסת"` |
| 5 | Bnei Brak | Chareidi core | 32.0830, 34.8330 | 3500 | `"בית כנסת"`, also `"shul"` |
| 6 | Beit Shemesh — Ramat Beit Shemesh | Chareidi + Anglo MO | 31.7480, 34.9990 | 5000 | `"בית כנסת"` |
| 7 | Modiin / Maccabim / Reut | Anglo-friendly | 31.8990, 35.0070 | 6000 | `"בית כנסת"` |
| 8 | Tel Aviv — center (incl. Tel Aviv Port, Florentin, Old North) | Tourist hub | 32.0810, 34.7820 | 5000 | `"בית כנסת"`, also `"synagogue"` |
| 9 | Tzfat | Religious tourism | 32.9650, 35.4960 | 2000 | `"בית כנסת"` |
| 10 | Tiberias | Religious tourism | 32.7900, 35.5320 | 2500 | `"בית כנסת"` |
| 11 | Netanya | Anglo retirement | 32.3320, 34.8580 | 5000 | `"בית כנסת"` |
| 12 | Ashdod | Sephardic + Chareidi | 31.7950, 34.6420 | 6000 | `"בית כנסת"` |
| 13 | Eilat | Vacation hub | 29.5560, 34.9520 | 5000 | `"בית כנסת"` |

### Florida (winter Pesach + year-round vacation)

| # | Name | Notes | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 14 | Boca Raton, FL | Winter retirement + Pesach | 26.3590, -80.0830 | 6000 | `"synagogue"`, also `"shul"` |
| 15 | Hollywood / Hallandale Beach, FL | Year-round | 25.9870, -80.1480 | 5000 | `"synagogue"`, also `"shul"` |
| 16 | Orlando area (Disney) | Family travel | 28.4180, -81.5810 | 15000 | `"synagogue"`, also `"Chabad"` |
| 17 | Tampa / St. Petersburg | Vacation | 27.9700, -82.4500 | 12000 | `"synagogue"`, also `"Chabad"` |
| 18 | Naples / Marco Island, FL | Winter | 26.1420, -81.7950 | 10000 | `"synagogue"`, also `"Chabad"` |

### Catskills / Hudson Valley (summer-only — June through Labor Day)

| # | Name | Notes | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 19 | South Fallsburg / Woodbourne / Monticello | Bungalow colonies | 41.7220, -74.6320 | 12000 | `"synagogue"`, also `"shul"`, `"shtiebel"` |
| 20 | Liberty / Loch Sheldrake / Hurleyville | Summer | 41.7980, -74.7470 | 8000 | `"synagogue"`, also `"shul"` |
| 21 | Ellenville / Mountain Dale | Summer | 41.7180, -74.4000 | 6000 | `"synagogue"`, also `"shul"` |
| 22 | Camp belt — Parksville to Swan Lake | Bungalow + camps | 41.8650, -74.7350 | 8000 | `"synagogue"`, also `"shul"` |

### Resort / vacation destinations

| # | Name | Notes | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 23 | Deal / Long Branch / Elberon, NJ | Summer Sephardic shore | 40.2540, -74.0010 | 5000 | `"synagogue"`, also `"shul"` |
| 24 | Las Vegas, NV | Tourism + Chabad | 36.1310, -115.1670 | 15000 | `"synagogue"`, also `"Chabad"` |
| 25 | Aspen / Vail, CO | Ski Pesach | 39.1980, -106.8210 | 10000 | `"Chabad"`, also `"synagogue"` |
| 26 | Park City / Deer Valley, UT | Ski | 40.6460, -111.4980 | 8000 | `"Chabad"`, also `"synagogue"` |
| 27 | Niagara Falls (US + Canada) | Family travel | 43.0900, -79.0850 | 8000 | `"synagogue"`, also `"Chabad"` |
| 28 | Cancun / Riviera Maya, Mexico | Pesach + vacation | 21.1620, -86.8510 | 25000 | `"Chabad"`, also `"synagogue"` |
| 29 | Cabo San Lucas, Mexico | Vacation | 22.8910, -109.9170 | 10000 | `"Chabad"` |
| 30 | Aruba | Caribbean | 12.5210, -69.9680 | 10000 | `"synagogue"`, also `"Chabad"` |
| 31 | Curaçao | Historic + tourism | 12.1090, -68.9320 | 12000 | `"synagogue"`, also `"Mikve Israel"` |

### European traveler hubs (vacation + business)

| # | Name | Notes | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 32 | Rome — Jewish Ghetto / Trastevere | Heritage tourism | 41.8920, 12.4780 | 3000 | `"synagogue"`, also `"sinagoga"` |
| 33 | Prague — Old Town / Josefov | Heritage tourism | 50.0900, 14.4180 | 2000 | `"synagogue"`, also `"synagoga"` |
| 34 | Venice — Cannaregio Ghetto | Heritage tourism | 45.4470, 12.3260 | 1500 | `"synagogue"`, also `"sinagoga"` |
| 35 | Madrid — Centro / Salamanca | Tourism | 40.4280, -3.6890 | 5000 | `"sinagoga"`, also `"synagogue"` |
| 36 | Barcelona — Eixample / Gòtic | Tourism | 41.3870, 2.1700 | 4000 | `"sinagoga"`, also `"synagogue"` |
| 37 | Athens — Plaka / Monastiraki | Tourism | 37.9750, 23.7280 | 4000 | `"synagogue"`, also `"συναγωγή"` |
| 38 | Istanbul — Galata / Beyoğlu | Sephardic heritage | 41.0270, 28.9740 | 3000 | `"synagogue"`, also `"sinagog"` |
| 39 | Greek islands (Rhodes / Corfu) | Sephardic heritage | 36.4480, 28.2240 | 6000 | `"synagogue"` |

### Other notable

| # | Name | Notes | Center | Radius (m) | Primary query |
|---|---|---|---|---|---|
| 40 | Hawaii — Honolulu | Vacation | 21.3070, -157.8580 | 15000 | `"synagogue"`, also `"Chabad"` |
| 41 | Banff / Calgary / Whistler | Ski | 51.0480, -114.0710 | 15000 | `"Chabad"`, also `"synagogue"` |
| 42 | Reykjavik | Tourism | 64.1470, -21.9420 | 15000 | `"Chabad"` |
| 43 | Tokyo — Hiroo / Roppongi | Business + tourism | 35.6520, 139.7170 | 6000 | `"synagogue"`, also `"Chabad"` |
| 44 | Hong Kong — Mid-Levels | Business + expat | 22.2780, 114.1500 | 4000 | `"synagogue"`, also `"Chabad"` |
| 45 | Bangkok — Sukhumvit | Tourism + Chabad | 13.7430, 100.5640 | 6000 | `"Chabad"`, also `"synagogue"` |
| 46 | Dubai — DIFC / Downtown | New community | 25.2100, 55.2780 | 8000 | `"synagogue"`, also `"Jewish"` |
| 47 | Sydney — Bondi / Double Bay | Vacation + expat | -33.8920, 151.2680 | 5000 | `"synagogue"`, also `"shul"` |
| 48 | Cape Town — Sea Point / Camps Bay | Vacation + community | -33.9180, 18.3870 | 5000 | `"synagogue"`, also `"shul"` |

---

## Coverage estimates

| Region | Rows | Daveners covered (est.) | Notes |
|---|---|---|---|
| North America Tier 1 | 15 | 597,000 | ~65% of NA daveners |
| North America Tier 2 | 23 | 193,000 | brings NA to ~85% |
| Europe Tier 1 + 2 | 15 | ~150,000 | ~80% of European daveners |
| Travel destinations | 35 | N/A (visitors, not residents) | covers Israel + major vacation/business hubs |
| **Total rows** | **88** | | |

At 20 results per Places query × ~2 queries average per row (one English `"synagogue"`, one targeted variant like `"shul"` or `"Chabad"`), this is ~176 Places API calls. At Places Text Search v1's pricing (~$0.032/call after free tier), full-run cost is **~$5.60**. Run-once.

---

## Next steps

1. **Eyeball this list.** Add anything missing — local knowledge will catch what demographic data misses. Especially worth a second look: are there major communities in Tier 1/2 you'd be embarrassed not to launch with? Are any travel destinations missing?
2. **Decide on launch geo.** One row from Tier 1 to start. Recommend Crown Heights or Lakewood — densest, easiest to validate coverage by sight.
3. **Build the `shul_candidate` schema** — minimal: `(id, place_id, name, address, lat, lng, website_uri, types, source, raw_response_json, created_at, reviewed_at, review_status, shul_id)`. `place_id` UNIQUE for dedup across runs.
4. **Build a small Node script** — reads this file, runs the Places queries for the target row, inserts into `shul_candidate`. Idempotent on `place_id`.
5. **Build the admin triage page** `/admin/candidates` — list of candidates with name/address/types/website link. Three actions per row: Approve (creates `shul` row + queues extraction via existing pipeline), Reject (sets review_status + reason), Skip (defer). Bulk-approve for trusted runs.
6. **Run the script for ONE neighborhood. Triage. Approve the legit ones. Verify the extraction pipeline catches them.**
7. **Iterate prompt + filters based on what shows up.** Most likely problems: Reform/Conservative shuls mixed in with Orthodox, dead shul rows in Places, places-of-worship that aren't shuls at all.
8. **Template the workflow for the next row.** Same script + admin pass.

This file is the static configuration. Treat it like `IDEAS.md` / `FEATURES.md` — edit when you learn something, commit the diff. Future scrapers (approach B — directory crawling) can drop their findings into the same `shul_candidate` table with `source` set differently.
