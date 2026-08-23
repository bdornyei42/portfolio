// Serves the static site from ./site (see wrangler.jsonc "assets"), but
// requires HTTP Basic Auth on everything under /admin/*. Credentials are
// read from the ADMIN_USER / ADMIN_PASSWORD secrets (set once with
// `wrangler secret put`) — never hardcoded here, never committed anywhere.

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function unauthorized() {
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin", charset="UTF-8"' },
  });
}

// Server-side store for the private year planner. State is one JSON blob in KV.
// Already behind the /admin Basic Auth gate below, so no extra auth here.
const PLANNER_KEY = "planner:state";
const PLANNER_MAX_BYTES = 3 * 1024 * 1024; // 3 MB guard

async function handlePlanner(request, env) {
  if (!env.PLANNER_KV) {
    return json({ error: "KV not configured" }, 500);
  }
  if (request.method === "GET") {
    const raw = await env.PLANNER_KV.get(PLANNER_KEY);
    if (!raw) return json({ __empty: true });
    return new Response(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (request.method === "PUT" || request.method === "POST") {
    // POST is accepted as an alias for the sendBeacon flush-on-close path.
    const body = await request.text();
    if (body.length > PLANNER_MAX_BYTES) return json({ error: "too large" }, 413);
    try { JSON.parse(body); } catch { return json({ error: "invalid JSON" }, 400); }
    await env.PLANNER_KV.put(PLANNER_KEY, body);
    return json({ ok: true, savedAt: Date.now() });
  }
  return json({ error: "method not allowed" }, 405);
}

// Same shape as the planner, for the private connection tracker's network map.
const CONNECTIONS_KEY = "connections:state";
const CONNECTIONS_MAX_BYTES = 3 * 1024 * 1024; // 3 MB guard

async function handleConnections(request, env) {
  if (!env.CONNECTIONS_KV) {
    return json({ error: "KV not configured" }, 500);
  }
  if (request.method === "GET") {
    const raw = await env.CONNECTIONS_KV.get(CONNECTIONS_KEY);
    if (!raw) return json({ __empty: true });
    return new Response(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (request.method === "PUT" || request.method === "POST") {
    // POST is accepted as an alias for the sendBeacon flush-on-close path.
    const body = await request.text();
    if (body.length > CONNECTIONS_MAX_BYTES) return json({ error: "too large" }, 413);
    try { JSON.parse(body); } catch { return json({ error: "invalid JSON" }, 400); }
    await env.CONNECTIONS_KV.put(CONNECTIONS_KEY, body);
    return json({ ok: true, savedAt: Date.now() });
  }
  return json({ error: "method not allowed" }, 405);
}

// Same shape again, for the private budget dashboard. The local SimpleFin sync
// script (private/sync.js) PUTs the categorized {accounts, transactions} blob
// here; /admin/budget.html GETs it back. Raw credentials never touch the site.
const BUDGET_KEY = "budget:state";
const BUDGET_MAX_BYTES = 3 * 1024 * 1024; // 3 MB guard

// Budget spending goals live in the same KV under their own key. Written by the
// budget page (not by sync.js, so a sync never clobbers your goals), read back
// on load. Same GET/PUT contract as everything else.
const BUDGET_GOALS_KEY = "budget:goals";

// Manual category overrides, keyed by merchant description. The budget page
// writes these when you click a transaction's tag and pick a new category; they
// survive every sync (sync re-categorizes from scratch, but never touches this
// key), so "BENDE INC. → Food" sticks for past and future rows alike.
const BUDGET_OVERRIDES_KEY = "budget:overrides";

// Recurring income/expense rules (rent, subscriptions, the weekly stipend, …),
// written by the budget page's "Recurring" tab, used to build the forecast.
const BUDGET_RECURRING_KEY = "budget:recurring";

async function handleBudget(request, env, key = BUDGET_KEY) {
  if (!env.BUDGET_KV) {
    return json({ error: "KV not configured" }, 500);
  }
  if (request.method === "GET") {
    const raw = await env.BUDGET_KV.get(key);
    if (!raw) return json({ __empty: true });
    return new Response(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (request.method === "PUT" || request.method === "POST") {
    const body = await request.text();
    if (body.length > BUDGET_MAX_BYTES) return json({ error: "too large" }, 413);
    try { JSON.parse(body); } catch { return json({ error: "invalid JSON" }, 400); }
    await env.BUDGET_KV.put(key, body);
    return json({ ok: true, savedAt: Date.now() });
  }
  return json({ error: "method not allowed" }, 405);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      const auth = request.headers.get("Authorization") || "";
      const expected = "Basic " + btoa(`${env.ADMIN_USER}:${env.ADMIN_PASSWORD}`);
      if (!timingSafeEqual(auth, expected)) return unauthorized();

      // Planner API (GET/PUT the JSON state), gated by the check above.
      if (url.pathname === "/admin/api/planner") return handlePlanner(request, env);
      // Connection tracker API (GET/PUT the JSON network state), same gate.
      if (url.pathname === "/admin/api/connections") return handleConnections(request, env);
      // Budget API (GET the synced accounts/transactions, PUT from sync.js), same gate.
      if (url.pathname === "/admin/api/budget") return handleBudget(request, env);
      // Budget goals (GET/PUT from the budget page), stored under a separate key.
      if (url.pathname === "/admin/api/budget/goals") return handleBudget(request, env, BUDGET_GOALS_KEY);
      // Manual category overrides (GET/PUT from the budget page), own key.
      if (url.pathname === "/admin/api/budget/overrides") return handleBudget(request, env, BUDGET_OVERRIDES_KEY);
      // Recurring income/expense rules (GET/PUT from the budget page), own key.
      if (url.pathname === "/admin/api/budget/recurring") return handleBudget(request, env, BUDGET_RECURRING_KEY);
    }

    return env.ASSETS.fetch(request);
  },
};
