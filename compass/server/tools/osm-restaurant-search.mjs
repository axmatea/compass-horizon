// REAL tool: restaurant search on OpenStreetMap (Nominatim geocoding + Overpass query). Keyless.
// Honest scope: finds places tagged with the cuisine near the place. It does NOT check
// availability, opening status for the requested time, or book anything.
// Usage policies: identifying User-Agent, <=1 Nominatim request/s, results cached.

const UA = 'COMPASS-voice-agent/0.1 (hackathon demo; OpenStreetMap data (c) OSM contributors, ODbL)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const CUISINE_RU = { italian: 'итальянские', japanese: 'японские', sushi: 'суши', mexican: 'мексиканские', french: 'французские', chinese: 'китайские', indian: 'индийские', thai: 'тайские', georgian: 'грузинские', korean: 'корейские', vietnamese: 'вьетнамские', greek: 'греческие', american: 'американские', pizza: 'пиццерии', burger: 'бургерные', seafood: 'рыбные', steak_house: 'стейк-хаусы', mediterranean: 'средиземноморские', russian: 'русские', uzbek: 'узбекские' };
const NUM_EN = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];

export const cuisineTag = (c) => String(c || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');

function haversineKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function listNames(names, and) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;
}

export function createOsmRestaurantSearch({ fetchImpl = fetch, radiusM = 3000, limit = 5, timeoutMs = 5000, overpassBudgetMs = 3000, cacheTtlMs = 10 * 60_000, endpoints = OVERPASS, now = () => Date.now() } = {}) {
  const geoCache = new Map();
  const resultCache = new Map();
  // Nominatim policy: at most 1 request per second. Serialize through one queue.
  let nominatimChain = Promise.resolve();
  let lastNominatim = 0;
  function nominatim(params, signal) {
    const run = async () => {
      const wait = Math.max(0, lastNominatim + 1000 - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      signal.throwIfAborted();
      lastNominatim = Date.now();
      const r = await fetchImpl(`${NOMINATIM}?${new URLSearchParams({ format: 'jsonv2', ...params })}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (!r.ok) throw new Error(`nominatim http ${r.status}`);
      return r.json();
    };
    const p = nominatimChain.then(run, run);
    nominatimChain = p.catch(() => {});
    return p;
  }

  async function geocode(place, signal) {
    const key = place.toLowerCase();
    if (geoCache.has(key)) return geoCache.get(key);
    const [hit] = await nominatim({ q: place, limit: '1' }, signal);
    const out = hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
    geoCache.set(key, out);
    return out;
  }

  async function overpass(query, signal) {
    let lastErr;
    for (const url of endpoints) {
      try {
        signal.throwIfAborted();
        const r = await fetchImpl(url, {
          method: 'POST', body: new URLSearchParams({ data: query }),
          headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        });
        if (!r.ok) throw new Error(`overpass http ${r.status}`);
        return await r.json();
      } catch (err) { lastErr = err; if (signal.aborted) throw err; }
    }
    throw lastErr;
  }

  const hasCuisine = (value, tag) => String(value || '').split(';').some((c) => c.trim() === tag || c.trim().startsWith(`${tag}_`));

  function shape(items, center, location) {
    const seen = new Set();
    return items
      .filter((x) => x.name && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()))
      .map((x) => ({
        name: x.name,
        area: x.city || location,
        availableAt: null, // not checked: OSM has no reservation data
        distanceKm: Math.round(haversineKm(center, x) * 10) / 10,
        address: x.address || null,
        openingHours: x.openingHours || null,
        website: x.website || null,
        osmUrl: x.osmUrl,
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
  }

  async function viaOverpass(tag, center, signal) {
    // Exact tag match is index-backed and fast; regexes over "cuisine" made Overpass time out (measured).
    const q = `[out:json][timeout:6];nwr["amenity"="restaurant"]["cuisine"="${tag}"]["name"](around:${radiusM},${center.lat},${center.lon});out center tags 40;`;
    const data = await overpass(q, signal);
    return (data.elements || []).map((e) => {
      const pos = e.center || { lat: e.lat, lon: e.lon };
      const t = e.tags || {};
      return { name: t.name, lat: pos.lat, lon: pos.lon, city: t['addr:city'], address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), openingHours: t.opening_hours, website: t.website || t['contact:website'], osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}` };
    });
  }

  async function viaNominatim(tag, center, signal) {
    const d = radiusM / 111_000;
    const viewbox = [center.lon - d, center.lat + d, center.lon + d, center.lat - d].join(',');
    const rows = await nominatim({ q: 'restaurant', limit: '40', bounded: '1', extratags: '1', addressdetails: '1', viewbox }, signal);
    return rows
      .filter((r) => hasCuisine(r.extratags?.cuisine, tag))
      .map((r) => ({ name: r.name, lat: Number(r.lat), lon: Number(r.lon), city: r.address?.city || r.address?.town, address: [r.address?.house_number, r.address?.road].filter(Boolean).join(' '), openingHours: r.extratags?.opening_hours, website: r.extratags?.website, osmUrl: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` }));
  }

  return {
    name: 'restaurant_search',
    description: 'Find real restaurants of a cuisine near a place (OpenStreetMap). Does not check availability or book.',
    mock: false,
    sideEffect: false,
    source: 'openstreetmap',
    // Map results do not depend on date/time, so a date or time change reuses them honestly.
    dependsOn: ['cuisine', 'location'],
    requires: ['cuisine', 'location'],
    argsFromIntent: (i) => ({ cuisine: i.cuisine, location: i.location }),
    async run(args, { signal = new AbortController().signal } = {}) {
      const tag = cuisineTag(args.cuisine);
      const key = `${tag}|${String(args.location).toLowerCase()}`;
      const cached = resultCache.get(key);
      if (cached && now() - cached.at < cacheTtlMs) return { ...cached.value, cached: true };

      const center = await geocode(args.location, signal);
      if (!center) return { mock: false, source: 'openstreetmap', query: args, center: null, results: [] };
      // Complete data (Overpass) races a fast partial source (Nominatim POI search); Overpass
      // wins if it answers within the budget. Public Overpass throttles per IP, so this bounds latency.
      const inner = new AbortController();
      const sig = AbortSignal.any([signal, inner.signal]);
      const op = viaOverpass(tag, center, sig).then((items) => ({ items, via: 'overpass' }));
      const nm = viaNominatim(tag, center, sig).then((items) => ({ items, via: 'nominatim' }));
      op.catch(() => {}); nm.catch(() => {});
      let winner;
      try {
        winner = await Promise.race([op, new Promise((_, rej) => setTimeout(() => rej(new Error('overpass budget')), overpassBudgetMs))]);
      } catch {
        // Partial source if it found something; an empty partial answer is not a real "none found", so keep waiting for Overpass.
        winner = await nm.then((r) => (r.items.length ? r : op), () => op);
      }
      inner.abort();
      const value = { mock: false, source: 'openstreetmap', via: winner.via, query: args, center, results: shape(winner.items, center, args.location) };
      resultCache.set(key, { at: now(), value });
      return value;
    },
    summarize(result, intent, lang = 'en') {
      const names = result.results.slice(0, 3).map((r) => r.name);
      const where = intent.location;
      if (lang === 'ru') {
        if (!names.length) return `На карте нет ресторанов с кухней «${intent.cuisine}» рядом с ${where}.`;
        const kind = CUISINE_RU[cuisineTag(intent.cuisine)] || `с кухней «${intent.cuisine}»`;
        return `Вот ${kind} места рядом с ${where}: ${listNames(names, 'и')}. Свободные столики пока не проверены.`;
      }
      if (!names.length) return `I couldn't find ${intent.cuisine} places near ${where} on the map.`;
      const count = NUM_EN[names.length] ?? String(names.length);
      return `${count} ${intent.cuisine} places near ${where}: ${listNames(names, 'and')}. I haven't checked tables yet.`;
    },
  };
}
