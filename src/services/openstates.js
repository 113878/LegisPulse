// ─── Open States API v3 Client ────────────────────────────────
// Fetches Georgia General Assembly events + associated bills.
// Docs: https://v3.openstates.org/docs
// Requires VITE_OPENSTATES_API_KEY in .env

const OPENSTATES_BASE = "https://v3.openstates.org";
const API_KEY = import.meta.env.VITE_OPENSTATES_API_KEY;

// Use the human-readable name — the OCD ID intermittently causes 400 errors
// when percent-encoded by the browser's URL constructor.
const GA_JURISDICTION = "Georgia";

/**
 * Generic GET helper with API-key auth and retry for transient errors.
 * @param {string} path
 * @param {Record<string, string | string[]>} [params]
 * @param {number} [retries=2]
 */
async function get(path, params = {}, retries = 2) {
  if (!API_KEY) {
    console.warn(
      "VITE_OPENSTATES_API_KEY is not set — skipping Open States fetch.",
    );
    return null;
  }

  const url = new URL(path, OPENSTATES_BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    // Support repeated params (e.g. include=a&include=b)
    if (Array.isArray(v)) {
      v.forEach((val) => url.searchParams.append(k, val));
    } else {
      url.searchParams.set(k, v);
    }
  });

  const res = await fetch(url.toString(), {
    headers: {
      "X-API-KEY": API_KEY,
      Accept: "application/json",
    },
  });

  // Retry on transient errors (rate-limit 429, server errors 500+, and the
  // intermittent 400s the API sometimes sends)
  if (
    !res.ok &&
    retries > 0 &&
    [400, 429, 500, 502, 503, 504].includes(res.status)
  ) {
    const delay = res.status === 429 ? 4000 : 1500;
    console.warn(
      `Open States API ${res.status} — retrying in ${delay}ms (${retries} left)`,
    );
    await new Promise((r) => setTimeout(r, delay));
    return get(path, params, retries - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Open States API ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

/**
 * Fetch Georgia legislative events within a date range.
 *
 * Open States v3 GET /events
 * Query params:
 *   jurisdiction  – e.g. "Georgia" or the OCD id
 *   after         – ISO date string, limit to events starting after this date
 *   before        – ISO date string, limit to events starting before this date
 *   per_page      – max results per page (max 20 for events endpoint)
 *   page          – 1-indexed
 *
 * Each event includes:
 *   - name, description, classification, start_date, end_date
 *   - location { name, url }
 *   - links [{ url, note }]
 *   - participants [{ name, entity_type, note }]
 *   - agenda [{ description, related_entities [{ name, entity_type, ... }] }]
 *     (related_entities contain associated bills)
 *
 * @param {string} [startDate] ISO string
 * @param {string} [endDate]   ISO string
 * @returns {Promise<Array>} normalised events
 */
export async function fetchGAEvents(startDate, endDate, maxPages = 5) {
  if (!API_KEY) return [];

  const allEvents = [];
  let page = 1;
  // The events endpoint rejects per_page > 20 with a 400
  const perPage = 20;

  // Paginate through all results
  while (true) {
    let data;
    try {
      data = await get("/events", {
        jurisdiction: GA_JURISDICTION,
        after: startDate ? startDate.slice(0, 10) : undefined,
        before: endDate ? endDate.slice(0, 10) : undefined,
        per_page: String(perPage),
        page: String(page),
        // Only request the fields we use: links for URLs, agenda for bills,
        // participants for committee/speaker info.
        include: ["links", "agenda", "participants"],
      });
    } catch (err) {
      // On rate-limit or network error mid-pagination, return what we have so far
      console.warn("Open States pagination stopped:", err.message);
      break;
    }

    if (!data || !data.results || data.results.length === 0) break;

    allEvents.push(...data.results);

    // If we got fewer than perPage, we're done
    if (data.results.length < perPage) break;
    page++;

    // Safety cap — caller can raise this for historical backfills
    if (page > maxPages) break;
  }

  return allEvents.map(normalizeEvent);
}

/**
 * Fetch a single event's details (includes full agenda + related bills).
 * @param {string} eventId  Open States event ID (e.g. "ocd-event/…")
 */
export async function fetchGAEventDetail(eventId) {
  if (!API_KEY) return null;

  // The v3 API uses the full OCD ID as path:
  // GET /events/{event_id}
  const data = await get(`/events/${encodeURIComponent(eventId)}`, {
    include: ["links", "agenda", "participants"],
  });
  if (!data) return null;
  return normalizeEvent(data);
}

// ─── Normalise into a calendar-friendly shape ────────────────
function normalizeEvent(ev) {
  // Collect associated bills from agenda items
  const bills = [];
  const seenBillIds = new Set();
  (ev.agenda ?? []).forEach((item) => {
    (item.related_entities ?? []).forEach((rel) => {
      // Bills are nested in rel.bill object per the v3 schema
      if (rel.bill) {
        const billId = rel.bill.id ?? rel.bill.identifier;
        if (billId && !seenBillIds.has(billId)) {
          seenBillIds.add(billId);
          bills.push({
            id: rel.bill.id ?? null,
            identifier: rel.bill.identifier ?? rel.name ?? "Unknown",
            title: rel.bill.title ?? "",
            session: rel.bill.session ?? "",
            note: item.description ?? "",
          });
        }
      }
    });
  });

  // Participants (committees, speakers, etc.)
  const participants = (ev.participants ?? []).map((p) => ({
    name: p.name,
    role: p.note ?? p.entity_type ?? "",
  }));

  // Location
  const locationName = ev.location?.name ?? "";
  const locationUrl = ev.location?.url ?? "";

  // Links
  const links = (ev.links ?? []).map((l) => ({
    url: l.url,
    note: l.note ?? "",
  }));

  // Build start/end times
  const startTime = ev.start_date || new Date().toISOString();
  // end_date can be "" (empty string) from the API — treat as missing
  const endTime =
    (ev.end_date && ev.end_date.length > 0 ? ev.end_date : null) ??
    (ev.end && ev.end.length > 0 ? ev.end : null) ??
    // Default: 1 hour after start
    new Date(new Date(startTime).getTime() + 3600000).toISOString();

  // All-day heuristic: if the time portion is midnight or missing
  const allDay =
    ev.all_day === true ||
    startTime.length <= 10 ||
    startTime.endsWith("T00:00:00+00:00");

  // Determine chamber color from event name
  const nameLower = (ev.name ?? "").toLowerCase();
  const eventColor = nameLower.startsWith("senate")
    ? "leg-senate"
    : nameLower.startsWith("house")
      ? "leg-house"
      : "gold";

  return {
    // Core fields — compatible with our calendar event shape
    id: ev.id,
    title: ev.name ?? "GA Legislature Event",
    description: ev.description ?? "",
    start_time: startTime,
    end_time: endTime,
    all_day: allDay,
    color: eventColor,
    location: locationName,
    location_url: locationUrl,

    // Legislative-specific
    classification: ev.classification ?? "",
    bills,
    participants,
    links,

    // Marker
    _source: "openstates",
  };
}
