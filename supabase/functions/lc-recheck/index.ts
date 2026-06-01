// supabase/functions/lc-recheck/index.ts
//
// Background re-check of LC numbers for all bills any user is
// tracking (personal + team). Writes detected changes into the
// global `bill_lc_history` table so every user gets a notification
// without needing to manually click Sync.
//
// ─── Environment variables ───────────────────────────────────────
//   SUPABASE_URL                — auto-set by the platform
//   SUPABASE_SERVICE_ROLE_KEY   — auto-set by the platform
//   LEGISCAN_API_KEY            — required; same key the client uses
//   LC_RECHECK_SECRET           — optional shared secret. If set,
//                                 requests must include the header
//                                 `x-recheck-secret: <value>`.
//
// ─── Invocation ──────────────────────────────────────────────────
// Manually:
//   curl -X POST \
//     -H "x-recheck-secret: $LC_RECHECK_SECRET" \
//     https://<project-ref>.supabase.co/functions/v1/lc-recheck
//
// Schedule via pg_cron + pg_net — see
//   supabase/migrations/025_schedule_lc_recheck.sql

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const LEGISCAN_BASE = "https://api.legiscan.com/";
const CONCURRENCY = 4;
const MAX_TEXT_ATTEMPTS = 2;

// ─── LC regex (mirror of src/services/legiscan.js) ───────────────
function extractLCNumber(text: string): string | null {
  if (!text) return null;
  const match = text.match(
    /\bLC\s+\d{2,3}\s+\d{3,5}(?:\s*(?:\/\s*)?(?:S|ERS|ER|SUB|AP|SB|CS|HL|HR|EC|AM|ENR|RH|RS|PH|PS)\b)*/i,
  );
  if (!match) return null;
  return match[0].replace(/\s+/g, " ").trim().toUpperCase();
}

// ─── Text payload decoding ───────────────────────────────────────
function stripHtml(value: string): string {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBase64IfLikely(value: string): string {
  if (!value) return "";
  // Heuristic: base64 strings are long, A-Za-z0-9+/=, no spaces
  const trimmed = value.replace(/\s+/g, "");
  if (
    trimmed.length > 100 &&
    /^[A-Za-z0-9+/]+=*$/.test(trimmed) &&
    trimmed.length % 4 === 0
  ) {
    try {
      const binary = atob(trimmed);
      // Drop NULs that indicate a PDF/binary blob (we can't parse PDFs here)
      if (binary.startsWith("%PDF")) return "";
      return binary;
    } catch {
      return value;
    }
  }
  return value;
}

function extractTextFromPayload(payload: any): string {
  if (!payload) return "";
  const candidates: string[] = [];
  if (typeof payload === "string") candidates.push(payload);
  else if (typeof payload === "object") {
    for (const k of [
      "text",
      "content",
      "doc",
      "document",
      "bill_text",
      "body",
      "full_text",
    ]) {
      if (typeof payload[k] === "string") candidates.push(payload[k]);
    }
  }

  let best = "";
  for (const c of candidates) {
    if (!c?.trim()) continue;
    const decoded = decodeBase64IfLikely(c);
    if (!decoded) continue;
    const normalized =
      decoded.includes("<") && decoded.includes(">")
        ? stripHtml(decoded)
        : decoded.replace(/\s+/g, " ").trim();
    if (normalized.length > best.length) best = normalized;
  }
  return best;
}

// ─── LegiScan API ────────────────────────────────────────────────
async function legiscanRequest(
  apiKey: string,
  operation: string,
  params: Record<string, string | number>,
): Promise<any> {
  const url = new URL(LEGISCAN_BASE);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("op", operation);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`LegiScan ${operation} HTTP ${res.status}`);
  const data = await res.json();
  if (data?.status !== "OK") {
    throw new Error(
      `LegiScan ${operation} failed: ${data?.alert?.message ?? "unknown"}`,
    );
  }
  return data;
}

async function fetchBillLCNumber(
  apiKey: string,
  legiscanBillId: string,
): Promise<string | null> {
  if (!legiscanBillId) return null;
  try {
    const data = await legiscanRequest(apiKey, "getBill", {
      id: legiscanBillId,
    });
    const bill = data.bill || {};
    const texts: any[] = Array.isArray(bill.texts) ? [...bill.texts] : [];
    texts.sort((a: any, b: any) => {
      const da = new Date(a?.date || 0).getTime() || 0;
      const db = new Date(b?.date || 0).getTime() || 0;
      return db - da;
    });

    let attempts = 0;
    for (const t of texts) {
      if (attempts >= MAX_TEXT_ATTEMPTS) break;
      const docId = t?.doc_id || t?.text_id || t?.id;
      if (!docId) continue;
      attempts += 1;
      try {
        const textResponse = await legiscanRequest(apiKey, "getBillText", {
          id: docId,
        });
        const content = extractTextFromPayload(textResponse?.text);
        if (content) {
          const lc = extractLCNumber(content);
          if (lc) return lc;
        }
        // Note: PDF-only documents are skipped here. The interactive
        // client-side sync has a PDF fallback; this background job
        // intentionally keeps things light. Any bills missed here
        // will still get caught the next time a user clicks Sync.
      } catch (err) {
        console.warn(`getBillText ${docId} failed:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn(
      `fetchBillLCNumber(${legiscanBillId}) failed:`,
      (err as Error).message,
    );
  }
  return null;
}

// ─── Main handler ────────────────────────────────────────────────
serve(async (req: Request) => {
  const expectedSecret = Deno.env.get("LC_RECHECK_SECRET");
  if (expectedSecret) {
    const got = req.headers.get("x-recheck-secret");
    if (got !== expectedSecret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const apiKey = Deno.env.get("LEGISCAN_API_KEY");
  if (!apiKey) {
    return new Response("LEGISCAN_API_KEY not set", { status: 500 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // 1. Collect every bill_number that any user is tracking
  //    (personal `tracked_bill_ids` ∪ `team_bills`).
  const billNumbers = new Set<string>();
  const [personalRes, teamRes] = await Promise.all([
    supabase.from("tracked_bill_ids").select("bill_id"),
    supabase.from("team_bills").select("bill_number"),
  ]);
  for (const r of personalRes.data ?? []) {
    if (r.bill_id) billNumbers.add(String(r.bill_id));
  }
  for (const r of teamRes.data ?? []) {
    if (r.bill_number) billNumbers.add(String(r.bill_number));
  }

  if (billNumbers.size === 0) {
    return Response.json({ checked: 0, changed: 0, billNumbers: 0 });
  }

  // 2. Resolve bill_number → legiscan_id (any user's row will do;
  //    they should match because the LegiScan id is the same for
  //    everyone). Take the first non-null row per bill_number.
  const numbersArr = [...billNumbers];
  const { data: billRows, error: billsErr } = await supabase
    .from("bills")
    .select("bill_number, legiscan_id")
    .in("bill_number", numbersArr)
    .not("legiscan_id", "is", null);
  if (billsErr) {
    return new Response(`bills query failed: ${billsErr.message}`, {
      status: 500,
    });
  }
  const legiscanByNumber = new Map<string, string>();
  for (const r of billRows ?? []) {
    if (!legiscanByNumber.has(r.bill_number)) {
      legiscanByNumber.set(r.bill_number, String(r.legiscan_id));
    }
  }

  // 3. Fetch LC for each, bounded concurrency
  const entries: { bill_number: string; lc_number: string }[] = [];
  const pairs = [...legiscanByNumber.entries()];
  let checked = 0;
  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const chunk = pairs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(([bn, legId]) =>
        fetchBillLCNumber(apiKey, legId).then((lc) => ({ bn, lc })),
      ),
    );
    for (const r of results) {
      checked += 1;
      if (r.status === "fulfilled" && r.value.lc) {
        entries.push({ bill_number: r.value.bn, lc_number: r.value.lc });
      }
    }
  }

  if (entries.length === 0) {
    return Response.json({
      checked,
      changed: 0,
      billNumbers: billNumbers.size,
    });
  }

  // 4. Cross-user change detection against bill_lc_history
  const { data: existingRows } = await supabase
    .from("bill_lc_history")
    .select("bill_number, current_lc, previous_lc, lc_changed_at")
    .in(
      "bill_number",
      entries.map((e) => e.bill_number),
    );
  const existingMap = new Map<string, any>();
  for (const r of existingRows ?? []) existingMap.set(r.bill_number, r);

  const now = new Date().toISOString();
  const upserts: any[] = [];
  const changes: {
    bill_number: string;
    previous_lc: string;
    current_lc: string;
  }[] = [];
  for (const { bill_number, lc_number } of entries) {
    const ex = existingMap.get(bill_number);
    const oldLc = ex?.current_lc ?? null;
    const isChange = oldLc !== null && oldLc !== lc_number;
    upserts.push({
      bill_number,
      current_lc: lc_number,
      previous_lc: isChange ? oldLc : (ex?.previous_lc ?? null),
      lc_changed_at: isChange ? now : (ex?.lc_changed_at ?? null),
      updated_at: now,
    });
    if (isChange) {
      changes.push({ bill_number, previous_lc: oldLc, current_lc: lc_number });
    }
  }

  const { error: upErr } = await supabase
    .from("bill_lc_history")
    .upsert(upserts, { onConflict: "bill_number" });
  if (upErr) {
    return new Response(`history upsert failed: ${upErr.message}`, {
      status: 500,
    });
  }

  // 5. Mirror the latest current_lc into per-user `bills.lc_number`
  //    so cards display the right value without each user re-syncing.
  //    (Safe: same value for everyone — it's the bill's actual LC.)
  for (const { bill_number, lc_number } of entries) {
    await supabase
      .from("bills")
      .update({ lc_number })
      .eq("bill_number", bill_number);
  }

  console.log(
    `lc-recheck: checked=${checked} changed=${changes.length}`,
    changes,
  );

  return Response.json({
    checked,
    changed: changes.length,
    billNumbers: billNumbers.size,
    changes,
  });
});
