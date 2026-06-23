/**
 * Geocode the distinct job locations → lat/lon, cache to geocache.json, and apply them to the
 * `jobs` index in place via _update_by_query (no re-embedding). Run after ingest:
 *
 *   npm run geocode
 *
 * Uses a built-in UK gazetteer for common places (fast, offline) and falls back to OSM Nominatim
 * for the long tail (rate-limited; failures are skipped → those jobs just won't appear on the map).
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { esClient, INDEX } from "@search/shared";

const CACHE = join(dirname(fileURLToPath(import.meta.url)), "..", "geocache.json");

type LatLon = { lat: number; lon: number };

// Common UK places (covers the high-volume locations without any network calls).
const GAZETTEER: Record<string, LatLon> = {
  London: { lat: 51.5074, lon: -0.1278 },
  "City of London": { lat: 51.5155, lon: -0.0922 },
  "West End": { lat: 51.5142, lon: -0.142 },
  Leeds: { lat: 53.8008, lon: -1.5491 },
  Manchester: { lat: 53.4808, lon: -2.2426 },
  Birmingham: { lat: 52.4862, lon: -1.8904 },
  Bristol: { lat: 51.4545, lon: -2.5879 },
  Liverpool: { lat: 53.4084, lon: -2.9916 },
  Nottingham: { lat: 52.9548, lon: -1.1581 },
  Glasgow: { lat: 55.8642, lon: -4.2518 },
  Sheffield: { lat: 53.3811, lon: -1.4701 },
  Southampton: { lat: 50.9097, lon: -1.4044 },
  Edinburgh: { lat: 55.9533, lon: -3.1883 },
  Reading: { lat: 51.4543, lon: -0.9781 },
  Leicester: { lat: 52.6369, lon: -1.1398 },
  Cardiff: { lat: 51.4816, lon: -3.1791 },
  Coventry: { lat: 52.4068, lon: -1.5197 },
  Newcastle: { lat: 54.9783, lon: -1.6178 },
  "Newcastle upon Tyne": { lat: 54.9783, lon: -1.6178 },
  Cambridge: { lat: 52.2053, lon: 0.1218 },
  Oxford: { lat: 51.752, lon: -1.2577 },
  Brighton: { lat: 50.8225, lon: -0.1372 },
  Milton: { lat: 52.04, lon: -0.76 },
  "Milton Keynes": { lat: 52.04, lon: -0.76 },
  Slough: { lat: 51.5105, lon: -0.5954 },
  Watford: { lat: 51.6565, lon: -0.3903 },
  Croydon: { lat: 51.3762, lon: -0.0982 },
  "South Croydon": { lat: 51.3622, lon: -0.0936 },
  Crawley: { lat: 51.1091, lon: -0.1872 },
  Wolverhampton: { lat: 52.5862, lon: -2.1288 },
  Derby: { lat: 52.9228, lon: -1.4765 },
  Portsmouth: { lat: 50.8198, lon: -1.088 },
  Aberdeen: { lat: 57.1497, lon: -2.0943 },
  Belfast: { lat: 54.5973, lon: -5.9301 },
  Norwich: { lat: 52.6309, lon: 1.2974 },
  Exeter: { lat: 50.7184, lon: -3.5339 },
  Bournemouth: { lat: 50.7192, lon: -1.8808 },
  Swindon: { lat: 51.5558, lon: -1.7797 },
  Luton: { lat: 51.8787, lon: -0.4200 },
  Bath: { lat: 51.3811, lon: -2.3590 },
  York: { lat: 53.959, lon: -1.0815 },
  Preston: { lat: 53.7632, lon: -2.7031 },
  Bradford: { lat: 53.795, lon: -1.759 },
  // regions → centroid
  England: { lat: 52.3, lon: -1.5 },
  Scotland: { lat: 56.5, lon: -4.2 },
  Wales: { lat: 52.3, lon: -3.8 },
  "Northern Ireland": { lat: 54.6, lon: -6.7 },
};

const SKIP = new Set(["International", "Fully Remote", "Remote", "Home Based", "UK", "United Kingdom"]);

async function nominatim(place: string): Promise<LatLon | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(place)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "mp-search-poc/0.1 (POC)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as { lat: string; lon: string }[];
    if (!arr.length) return null;
    return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const es = esClient();

  const agg: any = await es.search({
    index: INDEX,
    size: 0,
    aggs: { locs: { terms: { field: "location", size: 1000 } } },
  });
  const locations: string[] = agg.aggregations.locs.buckets.map((b: any) => b.key);
  console.log(`${locations.length} distinct locations`);

  const cache: Record<string, LatLon> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  let net = 0;
  for (const loc of locations) {
    if (cache[loc] || SKIP.has(loc)) continue;
    if (GAZETTEER[loc]) {
      cache[loc] = GAZETTEER[loc];
      continue;
    }
    await sleep(1100); // Nominatim: max ~1 req/s
    const hit = await nominatim(loc);
    if (hit) {
      cache[loc] = hit;
      net++;
    }
    if (net % 10 === 0 && net) console.log(`  geocoded ${net} via Nominatim…`);
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  console.log(`✓ geocache.json written (${Object.keys(cache).length} places)`);

  // Ensure the geo_point field exists, then apply coords in place.
  await es.indices.putMapping({ index: INDEX, properties: { geo: { type: "geo_point" } } as any });
  let updated = 0;
  for (const [loc, g] of Object.entries(cache)) {
    const r: any = await es.updateByQuery({
      index: INDEX,
      conflicts: "proceed",
      refresh: false,
      query: { term: { location: loc } },
      script: { source: "ctx._source.geo = params.g", params: { g: g } },
    });
    updated += r.updated ?? 0;
  }
  await es.indices.refresh({ index: INDEX });
  console.log(`✓ applied geo to ${updated} jobs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
