// Jackson Coffee Buddies (dornyei.com/jackson-coffee-buddies).
//
// One Durable Object ("jackson") holds the whole club in its own SQLite:
// members, login sessions, weekly groups of three, check-offs and photos.
// Strongly consistent, so two people ticking the same table never clobber
// each other the way a shared KV blob would.
//
// Weeks start Monday 00:00 New York time. A new week's tables are made the
// first time anyone opens the page that week, and by an alarm set for the
// next Monday, so it reshuffles on its own with nobody running anything.
//
// Phone numbers stay inside this object. The API never returns one (the
// organizer view only sees the last two digits).

import { DurableObject } from "cloudflare:workers";

const TZ = "America/New_York";
const DAY = 864e5;
const SESSION_DAYS = 180;
const MAX_IMG = 1.6 * 1024 * 1024;
const COOKIE = "jcb";

// The 2026-27 run, matched to Jackson's calendar (catalog.yale.edu/global-affairs/calendar).
// Round 1 stretches over November recess (Nov 21-29). No groups over winter break
// (Dec 18 - Jan 17) or spring recess (Mar 6-21). The last round ends with spring classes on
// Thu May 6, 2027; after that the page says it's back for 2027-28. New groups appear at
// 00:05 New York time on each round's first day.
const ROUNDS = [
  ["2026-11-13", "2026-11-29"], ["2026-11-30", "2026-12-06"], ["2026-12-07", "2026-12-13"], ["2026-12-14", "2026-12-17"],
  ["2027-01-18", "2027-01-24"], ["2027-01-25", "2027-01-31"], ["2027-02-01", "2027-02-07"], ["2027-02-08", "2027-02-14"],
  ["2027-02-15", "2027-02-21"], ["2027-02-22", "2027-02-28"], ["2027-03-01", "2027-03-05"],
  ["2027-03-22", "2027-03-28"], ["2027-03-29", "2027-04-04"], ["2027-04-05", "2027-04-11"], ["2027-04-12", "2027-04-18"],
  ["2027-04-19", "2027-04-25"], ["2027-04-26", "2027-05-02"], ["2027-05-03", "2027-05-06"],
];
const dayNum = (iso) => Date.parse(iso + "T00:00:00Z") / DAY;
const R = ROUNDS.map(([a, b], i) => ({ n: i + 1, start: a, end: b, s: dayNum(a), e: dayNum(b) }));

// ---------- time ----------
function nyDayNumber(ts = Date.now()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ts));
  const g = (t) => +p.find((x) => x.type === t).value;
  return Date.UTC(g("year"), g("month") - 1, g("day")) / DAY;
}
// current round number (the last round once the term is over)
export function weekOf(ts = Date.now()) {
  const d = nyDayNumber(ts);
  let n = 1;
  for (const r of R) if (d >= r.s) n = r.n;
  return n;
}
export function isOver(ts = Date.now()) { return nyDayNumber(ts) > R[R.length - 1].e; }
function weekRange(n) { const r = R[n - 1] || R[R.length - 1]; return { start: r.start, end: r.end }; }
// ms timestamp of 00:05 New York time on the next round's first day, or null after the last one
function nextMondayTs() {
  const nx = R[weekOf()];
  if (!nx) return null;
  for (const off of [4, 5]) { // EDT or EST
    const ts = nx.s * DAY + off * 3600e3 + 5 * 60e3;
    if (nyDayNumber(ts) === nx.s && nyDayNumber(ts - 10 * 60e3) === nx.s - 1) return ts;
  }
  return nx.s * DAY + 5 * 3600e3 + 5 * 60e3;
}
function weekInfo() {
  const n = weekOf();
  const d = nyDayNumber(), r = R[n - 1];
  return { n, ...weekRange(n), next: nextMondayTs(), total: R.length, last: n === R.length, over: isOver(),
    // between rounds (winter break, spring recess): no groups until the next round starts
    brk: !isOver() && d > r.e, nextStart: R[n]?.start || null };
}

// ---------- helpers ----------
const digits = (s) => String(s || "").replace(/\D/g, "");
// what people type into the sign-in box: 10 digits with no + or 00 means a US/Canadian number
function typedPhone(s) {
  const raw = String(s || "").trim(), d = digits(raw);
  if (d.length === 10 && /^[2-9]/.test(d) && !/^00/.test(raw)) return "1" + d;
  return d;
}
// unclaimed profiles whose name looks like the one being typed (to avoid duplicate people)
function nameTokens(s) { return slug(s).split("-").filter((t) => t.length > 1); }
function phoneMatch(stored, typed) {
  if (!stored || typed.length < 7) return false;
  if (stored === typed) return true;
  const k = Math.min(9, stored.length, typed.length);
  return k >= 7 && stored.slice(-k) === typed.slice(-k);
}
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function token() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
}
function slug(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member";
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
const err = (message, status = 400) => json({ error: message }, status);
function cleanName(s) {
  return String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}
function readCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

// Group sizes for n people: threes, with a four (or two) to absorb leftovers.
export function groupSizes(n) {
  if (n < 2) return [];
  if (n < 6) return [n];
  const k = Math.floor(n / 3), r = n % 3;
  if (r === 0) return Array(k).fill(3);
  if (r === 1) return [...Array(k - 1).fill(3), 4];
  return [...Array(k - 2).fill(3), 4, 4];
}

// Best-of-N randomized greedy, then pairwise swaps. cost = how many times two
// people already shared a table (recent repeats weigh a bit more).
export function makeGroups(ids, met, seed, tries = 40) {
  const rng = mulberry(seed);
  const sizes = groupSizes(ids.length);
  const c = (a, b) => met.get(a < b ? a + "|" + b : b + "|" + a) || 0;
  const groupCost = (g) => { let s = 0; for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) s += c(g[i], g[j]); return s; };
  let best = null, bestCost = Infinity;
  for (let t = 0; t < tries; t++) {
    const rest = ids.slice();
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const groups = [];
    let total = 0;
    for (const size of sizes) {
      const g = [rest.shift()];
      while (g.length < size) {
        let bi = 0, bv = Infinity;
        for (let i = 0; i < rest.length; i++) {
          let v = 0;
          for (const x of g) v += c(rest[i], x);
          if (v < bv) { bv = v; bi = i; if (v === 0) break; }
        }
        g.push(rest.splice(bi, 1)[0]);
        total += bv;
      }
      groups.push(g);
    }
    if (total < bestCost) { best = groups; bestCost = total; if (total === 0) break; }
  }
  // swap pass: move people between tables while it lowers the total
  for (let pass = 0; pass < 3 && bestCost > 0; pass++) {
    let improved = false;
    for (let a = 0; a < best.length; a++) {
      if (groupCost(best[a]) === 0) continue;
      for (let b = 0; b < best.length; b++) {
        if (a === b) continue;
        for (let i = 0; i < best[a].length; i++) for (let j = 0; j < best[b].length; j++) {
          const before = groupCost(best[a]) + groupCost(best[b]);
          [best[a][i], best[b][j]] = [best[b][j], best[a][i]];
          const after = groupCost(best[a]) + groupCost(best[b]);
          if (after < before) { bestCost -= before - after; improved = true; }
          else [best[a][i], best[b][j]] = [best[b][j], best[a][i]];
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

export class CoffeeClub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', wa TEXT NOT NULL DEFAULT '',
        phone TEXT, admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
        removed INTEGER NOT NULL DEFAULT 0, photo TEXT, jackson_photo TEXT, bio TEXT NOT NULL DEFAULT '',
        joined INTEGER NOT NULL, seen INTEGER);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, member TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS groups (
        week INTEGER NOT NULL, gid INTEGER NOT NULL, members TEXT NOT NULL,
        done_at INTEGER, done_by TEXT, cafe TEXT, PRIMARY KEY (week, gid));
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, owner TEXT NOT NULL,
        week INTEGER, gid INTEGER, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    `);
    // organizer powers come only from the organizer-link sign-in, never from a phone number
    if (!this.q("PRAGMA table_info(groups)").some((c) => c.name === "chat")) {
      this.sql.exec("ALTER TABLE groups ADD COLUMN chat TEXT");
      this.sql.exec("ALTER TABLE groups ADD COLUMN chat_by TEXT");
    }
    // one-time: numbers typed as 10 digits before typedPhone() existed were US/Canadian without the 1
    if (!this.q("SELECT v FROM meta WHERE k = 'fix_us_numbers_2'").length) {
      this.sql.exec("UPDATE members SET phone = '1' || phone WHERE length(phone) = 10 AND substr(phone, 1, 1) BETWEEN '2' AND '9'");
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('fix_us_numbers_2', '1')");
    }
    if (!this.q("SELECT v FROM meta WHERE k = 'fix_us_numbers'").length) {
      this.sql.exec("UPDATE members SET phone = '1' || phone WHERE length(phone) = 10 AND substr(phone, 1, 1) BETWEEN '2' AND '9'");
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('fix_us_numbers', '1')");
    }
    // finding a time: each member's free hours per group, the picked plan, and email opt-in
    this.sql.exec("CREATE TABLE IF NOT EXISTS avail (week INTEGER NOT NULL, gid INTEGER NOT NULL, member TEXT NOT NULL, slots TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (week, gid, member))");
    if (!this.q("PRAGMA table_info(groups)").some((c) => c.name === "plan_at")) {
      this.sql.exec("ALTER TABLE groups ADD COLUMN plan_at TEXT");
      this.sql.exec("ALTER TABLE groups ADD COLUMN plan_place TEXT");
      this.sql.exec("ALTER TABLE groups ADD COLUMN plan_by TEXT");
    }
    if (!this.q("PRAGMA table_info(members)").some((c) => c.name === "email")) {
      this.sql.exec("ALTER TABLE members ADD COLUMN email TEXT");
      this.sql.exec("ALTER TABLE members ADD COLUMN notify INTEGER NOT NULL DEFAULT 0");
    }
    if (!this.q("PRAGMA table_info(members)").some((c) => c.name === "no_photo"))
      this.sql.exec("ALTER TABLE members ADD COLUMN no_photo INTEGER NOT NULL DEFAULT 0");
    if (!this.q("PRAGMA table_info(members)").some((c) => c.name === "interests"))
      this.sql.exec("ALTER TABLE members ADD COLUMN interests TEXT NOT NULL DEFAULT '[]'");
    if (!this.q("PRAGMA table_info(sessions)").some((c) => c.name === "admin"))
      this.sql.exec("ALTER TABLE sessions ADD COLUMN admin INTEGER NOT NULL DEFAULT 0");
  }

  // ----- data access -----
  q(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.q(query, ...args)[0] || null; }
  member(id) { return this.one("SELECT * FROM members WHERE id = ? AND removed = 0", id); }
  // re-read a member after an edit, keeping this session's organizer flag
  getMeta(k) { return this.one("SELECT v FROM meta WHERE k = ?", k)?.v ?? null; }
  setMeta(k, v) { this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v); }

  // Email the organizer the new groups (names, numbers, WhatsApp links) so they can tell people.
  // Needs the send_email binding (EMAIL) and dornyei.com onboarded to Cloudflare Email Sending;
  // the address lives in this object's meta table (set from the organizer panel), not in the repo.
  async notifyRound(n, why = "new") {
    const to = this.getMeta("notify_email");
    if (!to) return { sent: false, error: "No email address set." };
    if (!this.env.EMAIL) return { sent: false, error: "Email isn't set up on the site yet (no EMAIL binding)." };
    if (why === "new" && this.getMeta("notified:" + n)) return { sent: false, error: "Already sent for this round." };
    const people = new Map(this.q("SELECT * FROM members").map((m) => [m.id, m]));
    const groups = this.q("SELECT * FROM groups WHERE week = ? ORDER BY gid", n).map((g) => JSON.parse(g.members).map((id) => people.get(id)).filter(Boolean));
    if (!groups.length) return { sent: false, error: "No groups this round." };
    const r = weekRange(n), url = "https://dornyei.com/jackson-coffee-buddies";
    const fmt = (d) => { const x = String(d); return x.length === 11 && x[0] === "1" ? `+1 (${x.slice(1, 4)}) ${x.slice(4, 7)}-${x.slice(7)}` : "+" + x; };
    const h = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const withNums = groups.flat().filter((m) => m.phone).length, total = groups.flat().length;
    const paste = `Round ${n} of Jackson Coffee Buddies is up (${r.start} to ${r.end}). See your group and say hi: ${url}`;
    const title = why === "test" ? `Coffee Buddies round ${n}: this round's groups` : why === "reshuffled" ? `Coffee Buddies round ${n}: groups were redone` : `Coffee Buddies round ${n}: ${groups.length} new groups`;
    const text = [title, `${r.start} to ${r.end}. ${withNums} of ${total} people have a number linked.`, "", "Paste in the Jackson group:", paste, "",
      ...groups.map((g, i) => `${i + 1}. ` + g.map((m) => `${m.name}${m.phone ? " " + fmt(m.phone) : " (no number yet)"}`).join(", "))].join("\n");
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f1a17;max-width:640px">
      <h2 style="color:#3152a4;margin:0 0 4px">${h(title)}</h2>
      <p style="margin:0 0 14px;color:#5a5048">${h(r.start)} to ${h(r.end)}. ${withNums} of ${total} people have a number linked.</p>
      <p style="margin:0 0 4px"><b>Paste in the Jackson group:</b></p>
      <p style="background:#f3ead8;padding:10px 12px;border-radius:8px;margin:0 0 18px">${h(paste)}</p>
      <table style="border-collapse:collapse;width:100%">${groups.map((g, i) => `<tr><td style="padding:8px 8px 8px 0;border-top:1px solid #e6dccb;vertical-align:top;color:#8d8278">${i + 1}</td><td style="padding:8px 0;border-top:1px solid #e6dccb">${g.map((m) => m.phone
        ? `<a href="https://wa.me/${m.phone}" style="color:#1f8f4e;font-weight:bold;text-decoration:none">${h(m.name)}</a> <span style="color:#8d8278">${h(fmt(m.phone))}</span>`
        : `<b>${h(m.name)}</b> <span style="color:#8d8278">(no number yet)</span>`).join("<br>")}</td></tr>`).join("")}</table>
      <p style="margin-top:18px;color:#8d8278;font-size:13px">Sent by ${h(url)}. Change or turn off these emails in the organizer section of the page.</p></div>`;
    try {
      await this.env.EMAIL.send({ to, from: { email: "coffee@dornyei.com", name: "Jackson Coffee Buddies" }, subject: title, html, text });
      if (why === "new") this.setMeta("notified:" + n, String(Date.now()));
      return { sent: true };
    } catch (e) {
      return { sent: false, error: String(e?.message || e) };
    }
  }

  // tell everyone in the group who asked for it: time, place, who's coming, calendar link
  async mailPlan(week, gid) {
    const g = this.one("SELECT * FROM groups WHERE week = ? AND gid = ?", week, gid);
    if (!g?.plan_at) return { sent: 0 };
    const people = JSON.parse(g.members).map((id) => this.member(id)).filter(Boolean);
    const to = people.filter((m) => m.notify && m.email).map((m) => m.email);
    if (!to.length) return { sent: 0 };
    if (!this.env.EMAIL) return { sent: 0, error: "Email isn't set up on the site yet." };
    const [d, hh] = g.plan_at.split("|"), h = +hh;
    const when = new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }) + ` at ${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
    const stamp = (hr) => d.replace(/-/g, "") + "T" + String(hr).padStart(2, "0") + "0000";
    const place = g.plan_place || "a café you pick together";
    const gcal = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent("Coffee: " + people.map((m) => m.name.split(" ")[0]).join(", ")) +
      "&dates=" + stamp(h) + "/" + stamp(h + 1) + "&ctz=America/New_York&location=" + encodeURIComponent(g.plan_place ? g.plan_place + ", New Haven, CT" : "New Haven, CT") +
      "&details=" + encodeURIComponent("Jackson Coffee Buddies, round " + week + ". https://dornyei.com/jackson-coffee-buddies");
    const h2 = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const names = people.map((m) => m.name).join(", ");
    const subject = `Coffee: ${when}, ${place}`;
    const text = `${subject}\nWith ${names}.\nAdd it to your calendar: ${gcal}\nSee your group: https://dornyei.com/jackson-coffee-buddies`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f1a17;max-width:560px">
      <h2 style="color:#3152a4;margin:0 0 6px">Coffee is on</h2>
      <p style="font-size:18px;margin:0 0 6px"><b>${h2(when)}</b><br>${h2(place)}</p>
      <p style="margin:0 0 16px;color:#5a5048">With ${h2(names)}.</p>
      <p><a href="${h2(gcal)}" style="background:#3152a4;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:bold">Add to Google Calendar</a></p>
      <p style="margin-top:18px;color:#8d8278;font-size:13px">You asked Jackson Coffee Buddies to email you when your group picks a time. Turn it off in your profile at https://dornyei.com/jackson-coffee-buddies</p></div>`;
    let sent = 0, error = "";
    for (const addr of to) {
      try { await this.env.EMAIL.send({ to: addr, from: { email: "coffee@dornyei.com", name: "Jackson Coffee Buddies" }, subject, html, text }); sent++; }
      catch (e) { error = String(e?.message || e); }
    }
    return { sent, error };
  }

  // take down every photo of a member (their upload and any headshot found online), for good
  dropPhotos(id) {
    this.sql.exec("DELETE FROM photos WHERE week IS NULL AND (owner = ? OR owner = ?)", id, "headshot:" + id);
    this.sql.exec("UPDATE members SET photo = NULL, jackson_photo = NULL, no_photo = 1 WHERE id = ?", id);
  }
  fresh(viewer) { return { ...this.member(viewer.id), admin: viewer.admin }; }

  metMap(exceptWeek = -1) {
    const met = new Map();
    const now = weekOf();
    for (const g of this.q("SELECT week, members FROM groups WHERE week != ?", exceptWeek)) {
      const ids = JSON.parse(g.members);
      const w = 1 + Math.max(0, 6 - (now - g.week)) * 0.05; // recent repeats cost a little more
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const k = ids[i] < ids[j] ? ids[i] + "|" + ids[j] : ids[j] + "|" + ids[i];
        met.set(k, (met.get(k) || 0) + w);
      }
    }
    return met;
  }

  // Make this week's tables if they don't exist yet. Deterministic per week.
  ensureWeek(n = weekOf(), salt = 0) {
    if (this.one("SELECT 1 AS x FROM groups WHERE week = ? LIMIT 1", n)) return false;
    const ids = this.q("SELECT id FROM members WHERE removed = 0 AND active = 1 AND name != '' ORDER BY id").map((r) => r.id);
    if (ids.length < 2) return false;
    const groups = makeGroups(ids, this.metMap(n), 20261116 + n * 7919 + salt);
    groups.forEach((g, i) => this.sql.exec("INSERT INTO groups (week, gid, members) VALUES (?, ?, ?)", n, i + 1, JSON.stringify(g)));
    return true;
  }

  // Keep groups at three when people leave. A group is only touched if nobody in it has signed in
  // since the round started and it hasn't met, made a chat or added photos (so nobody has been
  // in contact yet). Pairs take one person from an untouched group of four; a lone person joins
  // the smallest untouched group. Returns the number of moves.
  rebalance(n = weekOf()) {
    const w = weekInfo();
    if (w.over || w.brk || n !== w.n) return 0;
    const startTs = (R[n - 1].s * DAY) + 5 * 3600e3;
    const seen = new Map(this.q("SELECT id, seen FROM members").map((m) => [m.id, m.seen || 0]));
    const withPhotos = new Set(this.q("SELECT DISTINCT gid FROM photos WHERE week = ?", n).map((r) => r.gid));
    const load = () => this.q("SELECT * FROM groups WHERE week = ?", n).map((g) => ({ ...g, ids: JSON.parse(g.members) }));
    const untouched = (g) => !g.done_at && !g.chat && !withPhotos.has(g.gid) && g.ids.every((id) => seen.get(id) < startTs);
    const save = (g) => this.sql.exec("UPDATE groups SET members = ? WHERE week = ? AND gid = ?", JSON.stringify(g.ids), n, g.gid);
    const met = this.metMap(n);
    const cost = (id, ids) => ids.reduce((s2, x) => s2 + (met.get(id < x ? id + "|" + x : x + "|" + id) || 0), 0);
    let moves = 0;
    for (let guard = 0; guard < 20; guard++) {
      const gs = load();
      const small = gs.find((g) => g.ids.length <= 2 && g.ids.length > 0 && untouched(g));
      if (!small) break;
      if (small.ids.length === 2) {
        const big = gs.filter((g) => g.ids.length >= 4 && untouched(g))[0];
        if (!big) break;
        // move whoever from the four knows the pair least
        const pick = big.ids.slice().sort((a, b) => cost(a, small.ids) - cost(b, small.ids))[0];
        big.ids = big.ids.filter((x) => x !== pick); small.ids.push(pick);
        save(big); save(small); moves++;
      } else {
        const lone = small.ids[0];
        const target = gs.filter((g) => g.gid !== small.gid && g.ids.length && untouched(g)).sort((a, b) => a.ids.length - b.ids.length || cost(lone, a.ids) - cost(lone, b.ids))[0];
        if (!target) break;
        target.ids.push(lone); small.ids = []; save(target); save(small); moves++;
      }
    }
    return moves;
  }

  // Someone who joins mid-week sits down at the table where they know nobody.
  slotIn(id) {
    const w = weekInfo();
    if (w.over || w.brk) return; // nothing to join on a break or after the year ends
    const n = w.n;
    const groups = this.q("SELECT gid, members FROM groups WHERE week = ?", n).map((g) => ({ gid: g.gid, m: JSON.parse(g.members) }));
    if (!groups.length || groups.some((g) => g.m.includes(id))) return;
    const met = this.metMap();
    const cost = (g) => g.m.reduce((s, x) => s + (met.get(id < x ? id + "|" + x : x + "|" + id) || 0), 0) * 10 + g.m.length;
    groups.sort((a, b) => cost(a) - cost(b));
    const g = groups[0];
    g.m.push(id);
    this.sql.exec("UPDATE groups SET members = ? WHERE week = ? AND gid = ?", JSON.stringify(g.m), n, g.gid);
  }

  async ensureAlarm() {
    const cur = await this.ctx.storage.getAlarm();
    const nx = nextMondayTs();
    if (nx && (!cur || cur < Date.now())) await this.ctx.storage.setAlarm(nx);
  }

  async alarm() {
    if (this.ensureWeek()) await this.notifyRound(weekOf());
    const nx = nextMondayTs();
    if (nx) await this.ctx.storage.setAlarm(nx);
  }

  // ----- sessions -----
  session(request) {
    const t = readCookie(request, COOKIE);
    if (!t) return null;
    const s = this.one("SELECT * FROM sessions WHERE token = ?", t);
    if (!s || s.created < Date.now() - SESSION_DAYS * DAY) return null;
    const m = this.member(s.member);
    if (!m) return null;
    this.sql.exec("UPDATE members SET seen = ? WHERE id = ?", Date.now(), m.id);
    // the organizer signed in by phone is a normal member (their number is visible in the group)
    return { ...m, admin: m.admin && s.admin ? 1 : 0 };
  }
  startSession(memberId, payload = {}, admin = false) {
    const t = token();
    this.sql.exec("INSERT INTO sessions (token, member, created, admin) VALUES (?, ?, ?, ?)", t, memberId, Date.now(), admin ? 1 : 0);
    const cookie = `${COOKIE}=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
    return json({ ok: true, ...payload }, 200, { "Set-Cookie": cookie });
  }

  // Too many wrong numbers from one address in an hour → slow down.
  throttled(ip) {
    const hourAgo = Date.now() - 3600e3;
    this.sql.exec("DELETE FROM attempts WHERE ts < ?", hourAgo);
    return (this.one("SELECT COUNT(*) AS n FROM attempts WHERE ip = ?", ip)?.n || 0) >= 300;
  }
  miss(ip) { this.sql.exec("INSERT INTO attempts (ip, ts) VALUES (?, ?)", ip, Date.now()); }

  // ----- views -----
  // A number is shown to the person themself, to anyone who has shared a table
  // with them (any week), and to the organizer. Nobody else.
  pub(m, viewer) {
    if (!m) return null;
    const see = viewer && m.phone && (viewer.admin || m.id === viewer.id || this.mates?.has(m.id));
    return {
      id: m.id, name: m.name || m.wa || "New member", wa: m.wa && m.wa !== m.name ? m.wa : "",
      photo: m.photo ? `/api/coffee/img/${m.photo}` : m.jackson_photo || null,
      bio: m.bio || "", me: viewer ? m.id === viewer.id : undefined,
      phone: see ? "+" + m.phone : null, signedUp: !!m.phone,
      interests: (() => { try { return JSON.parse(m.interests || "[]"); } catch { return []; } })(),
    };
  }
  groupView(g, viewer, people) {
    const ids = JSON.parse(g.members);
    const photos = this.q("SELECT id, owner FROM photos WHERE week = ? AND gid = ? ORDER BY created", g.week, g.gid)
      .map((p) => ({ id: p.id, url: `/api/coffee/img/${p.id}`, mine: p.owner === viewer.id }));
    return {
      week: g.week, gid: g.gid,
      members: ids.map((id) => this.pub(people.get(id) || { id, name: "Former member" }, viewer)),
      done: !!g.done_at, doneAt: g.done_at, doneBy: g.done_by ? (people.get(g.done_by)?.name || "") : null,
      cafe: g.cafe || "", photos, mine: ids.includes(viewer.id),
      chat: g.chat || "", chatBy: g.chat_by ? (people.get(g.chat_by)?.name || "") : null,
      avail: Object.fromEntries(this.q("SELECT member, slots FROM avail WHERE week = ? AND gid = ?", g.week, g.gid).map((a) => [a.member, JSON.parse(a.slots)])),
      plan: g.plan_at ? { at: g.plan_at, place: g.plan_place || "", by: people.get(g.plan_by)?.name || "" } : null,
    };
  }

  me(viewer) {
    const n = weekOf();
    this.ensureWeek(n);
    const people = new Map(this.q("SELECT * FROM members").map((m) => [m.id, m]));
    const all = this.q("SELECT * FROM groups ORDER BY week DESC, gid");
    this.mates = new Set();
    for (const g of all) { const ids = JSON.parse(g.members); if (ids.includes(viewer.id)) ids.forEach((x) => this.mates.add(x)); }
    const mine = all.filter((g) => JSON.parse(g.members).includes(viewer.id)).map((g) => this.groupView(g, viewer, people));
    const thisWeek = all.filter((g) => g.week === n);
    const metIds = new Set();
    for (const g of mine) if (g.done) for (const p of g.members) if (p.id !== viewer.id) metIds.add(p.id);
    return {
      me: { ...this.pub(viewer, viewer), wa: viewer.wa, active: !!viewer.active, admin: !!viewer.admin, email: viewer.email || "", notify: !!viewer.notify },
      week: weekInfo(),
      group: mine.find((g) => g.week === n) || null,
      history: mine.filter((g) => g.week !== n),
      tables: thisWeek.map((g) => {
        const ids = JSON.parse(g.members);
        return { gid: g.gid, done: !!g.done_at, cafe: g.cafe || "", chat: ids.includes(viewer.id) ? g.chat || "" : "", members: ids.map((id) => this.pub(people.get(id) || { id, name: "?" }, viewer)) };
      }),
      stats: {
        members: this.one("SELECT COUNT(*) AS n FROM members WHERE removed = 0 AND name != ''").n,
        met: metIds.size,
        chats: mine.filter((g) => g.done).length,
      },
    };
  }

  // ----- request router -----
  async fetch(request) {
    await this.ensureAlarm();
    if (this.ensureWeek()) this.ctx.waitUntil(this.notifyRound(weekOf()));
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/coffee/, "") || "/";
    const method = request.method;
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const body = async () => { try { return await request.json(); } catch { return {}; } };

    // public: aggregate numbers only, for the signed-out landing page
    if (path === "/pulse" && method === "GET") {
      const n = weekOf();
      this.ensureWeek(n);
      const t = this.one("SELECT COUNT(*) AS n, SUM(done_at IS NOT NULL) AS d FROM groups WHERE week = ?", n);
      const members = this.one("SELECT COUNT(*) AS n FROM members WHERE removed = 0 AND name != ''").n;
      return json({ week: weekInfo(), tables: t.n, done: t.d || 0, members });
    }

    // ---- sign in by WhatsApp number ----
    if (path === "/login" && method === "POST") {
      if (this.throttled(ip)) return err("Too many tries. Wait a bit and try again.", 429);
      const { phone } = await body();
      const d = typedPhone(phone);
      if (d.length < 7) return err("Type the full number you use on WhatsApp.");
      const hits = this.q("SELECT * FROM members WHERE removed = 0 AND phone IS NOT NULL").filter((m) => phoneMatch(m.phone, d));
      if (hits.length === 1) {
        const m = hits[0];
        return this.startSession(m.id, { named: !!m.name });
      }
      this.miss(ip);
      return json({ ok: false, reason: "unknown" });
    }
    // unknown number → search unclaimed names (2+ letters, max 6 results)
    if (path === "/lookup" && method === "POST") {
      if (this.throttled(ip)) return err("Too many tries. Wait a bit and try again.", 429);
      const { query } = await body();
      const qn = slug(query || "");
      if (qn.length < 2) return json({ matches: [] });
      const parts = qn.split("-");
      const matches = this.q("SELECT id, name, wa FROM members WHERE removed = 0 AND phone IS NULL AND admin = 0 AND name != ''")
        .filter((m) => { const s = slug(m.name + " " + m.wa); return parts.every((p) => s.includes(p)); })
        .slice(0, 6).map((m) => ({ id: m.id, name: m.name, wa: m.wa !== m.name ? m.wa : "" }));
      return json({ matches });
    }
    if (path === "/claim" && method === "POST") {
      if (this.throttled(ip)) return err("Too many tries. Wait a bit and try again.", 429);
      const { phone, id } = await body();
      const d = typedPhone(phone);
      if (d.length < 7) return err("Type the full number you use on WhatsApp.");
      if (this.q("SELECT phone FROM members WHERE phone IS NOT NULL AND removed = 0").some((m) => phoneMatch(m.phone, d)))
        return err("That number already belongs to someone. Try signing in with it.");
      const m = this.member(id);
      if (!m || m.admin) return err("Couldn't find that name.");
      if (m.phone) return err("That name is already linked to another number. Message Ben and he'll sort it out.");
      this.sql.exec("UPDATE members SET phone = ? WHERE id = ?", d, m.id);
      return this.startSession(m.id, { named: true });
    }
    // not on the list at all → join (sits down at a table this week)
    if (path === "/join" && method === "POST") {
      if (this.throttled(ip)) return err("Too many tries. Wait a bit and try again.", 429);
      const { phone, name, force } = await body();
      const d = typedPhone(phone), nm = cleanName(name);
      if (d.length < 7) return err("Type the full number you use on WhatsApp.");
      if (nm.length < 2) return err("Add the name people know you by.");
      if (this.q("SELECT phone FROM members WHERE phone IS NOT NULL AND removed = 0").some((m) => phoneMatch(m.phone, d)))
        return err("That number already belongs to someone. Try signing in with it.");
      if (!force) {
        const want = nameTokens(nm);
        const matches = this.q("SELECT id, name, wa FROM members WHERE removed = 0 AND phone IS NULL AND admin = 0 AND name != ''")
          .filter((m) => { const have = new Set([...nameTokens(m.name), ...nameTokens(m.wa)]); return want.length && have.has(want[0]); })
          .slice(0, 6).map((m) => ({ id: m.id, name: m.name, wa: m.wa !== m.name ? m.wa : "" }));
        if (matches.length) return json({ ok: false, reason: "maybe", matches });
      }
      let id = slug(nm), k = 2;
      while (this.one("SELECT 1 AS x FROM members WHERE id = ?", id)) id = slug(nm) + "-" + k++;
      this.sql.exec("INSERT INTO members (id, name, wa, phone, joined) VALUES (?, ?, ?, ?, ?)", id, nm, nm, d, Date.now());
      this.slotIn(id);
      return this.startSession(id, { named: true });
    }
    // organizer sign-in with the COFFEE_ADMIN_TOKEN secret
    if (path === "/admin/login" && method === "POST") {
      const { token: t } = await body();
      if (!this.env.COFFEE_ADMIN_TOKEN || t !== this.env.COFFEE_ADMIN_TOKEN) { this.miss(ip); return err("Wrong key.", 403); }
      const a = this.one("SELECT id FROM members WHERE admin = 1 AND removed = 0 LIMIT 1");
      if (!a) return err("No organizer on the roster.", 404);
      return this.startSession(a.id, { named: true }, true);
    }
    // roster upload (Bearer COFFEE_ADMIN_TOKEN): adds new people, fills gaps, never overwrites names people chose
    if (path === "/admin/seed" && method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (!this.env.COFFEE_ADMIN_TOKEN || auth !== "Bearer " + this.env.COFFEE_ADMIN_TOKEN) return err("forbidden", 403);
      const list = await body();
      if (!Array.isArray(list)) return err("expected an array");
      let added = 0, updated = 0;
      for (const r of list) {
        if (!r.id) continue;
        const ex = this.one("SELECT * FROM members WHERE id = ?", r.id);
        if (ex?.removed) continue; // deleted their account or removed by the organizer: stay gone
        if (!ex) {
          this.sql.exec("INSERT INTO members (id, name, wa, phone, admin, jackson_photo, joined) VALUES (?, ?, ?, ?, ?, ?, ?)",
            r.id, cleanName(r.name), cleanName(r.wa || r.name), r.phone ? digits(r.phone) : null, r.admin ? 1 : 0, r.jackson_photo || null, Date.now());
          added++;
        } else {
          // names are only corrected for people who haven't signed in (and so haven't picked their own)
          this.sql.exec("UPDATE members SET phone = COALESCE(phone, ?), jackson_photo = CASE WHEN no_photo = 1 OR jackson_photo LIKE '/api/%' THEN jackson_photo ELSE COALESCE(?, jackson_photo) END, admin = ?, wa = ?, name = CASE WHEN seen IS NULL AND ? != '' THEN ? ELSE name END WHERE id = ?",
            r.phone ? digits(r.phone) : null, r.jackson_photo || null, r.admin ? 1 : 0, cleanName(r.wa || ex.wa), cleanName(r.name), cleanName(r.name), r.id);
          updated++;
        }
      }
      return json({ ok: true, added, updated, week: weekOf() });
    }

    // headshot upload (Bearer COFFEE_ADMIN_TOKEN): stored here and served only to signed-in
    // members, instead of hotlinking web.archive.org (which cuts off a page loading ~50 images)
    if (path === "/admin/memberphoto" && method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (!this.env.COFFEE_ADMIN_TOKEN || auth !== "Bearer " + this.env.COFFEE_ADMIN_TOKEN) return err("forbidden", 403);
      const m = this.one("SELECT id, jackson_photo, no_photo FROM members WHERE id = ? AND removed = 0", url.searchParams.get("id"));
      if (!m) return err("no such member", 404);
      if (m.no_photo) return json({ ok: true, skipped: "photo was taken down" });
      const mime = (request.headers.get("Content-Type") || "").split(";")[0];
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return err("image only");
      const data = await request.arrayBuffer();
      if (!data.byteLength || data.byteLength > MAX_IMG) return err("bad size");
      const old = (m.jackson_photo || "").match(/^\/api\/coffee\/img\/(.+)$/);
      if (old) this.sql.exec("DELETE FROM photos WHERE id = ?", old[1]);
      const pid = token().slice(0, 20);
      this.sql.exec("INSERT INTO photos (id, mime, data, owner, created) VALUES (?, ?, ?, ?, ?)", pid, mime, data, "headshot:" + m.id, Date.now());
      this.sql.exec("UPDATE members SET jackson_photo = ? WHERE id = ?", `/api/coffee/img/${pid}`, m.id);
      return json({ ok: true, url: `/api/coffee/img/${pid}` });
    }

    // ---- everything below needs a session ----
    const viewer = this.session(request);
    if (!viewer) return err("signed out", 401);

    if (path === "/me" && method === "GET") return json(this.me(viewer));

    if (path === "/logout" && method === "POST") {
      this.sql.exec("DELETE FROM sessions WHERE token = ?", readCookie(request, COOKIE));
      return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    }

    // Delete my account: wipe what we know about them, take them out of this round's group
    // (unless it already met), sign them out everywhere. Past groups show "Former member".
    if (path === "/leave" && method === "POST") {
      if (viewer.admin || this.one("SELECT admin FROM members WHERE id = ?", viewer.id)?.admin) return err("The organizer can't delete their own account here.", 400);
      const w = weekInfo();
      const g = this.q("SELECT * FROM groups WHERE week = ?", w.n).find((x) => JSON.parse(x.members).includes(viewer.id));
      if (g && !g.done_at && !w.over && !w.brk) {
        const rest = JSON.parse(g.members).filter((x) => x !== viewer.id);
        this.sql.exec("UPDATE groups SET members = ? WHERE week = ? AND gid = ?", JSON.stringify(rest), g.week, g.gid);
      }
      this.sql.exec("DELETE FROM photos WHERE owner = ? OR owner = ?", viewer.id, "headshot:" + viewer.id);
      this.sql.exec("UPDATE members SET name = 'Former member', wa = '', phone = NULL, photo = NULL, jackson_photo = NULL, bio = '', interests = '[]', email = NULL, notify = 0, active = 0, removed = 1 WHERE id = ?", viewer.id);
      this.sql.exec("DELETE FROM sessions WHERE member = ?", viewer.id);
      this.rebalance();
      return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    }

    if (path === "/profile" && method === "POST") {
      const b = await body();
      if (b.name !== undefined) {
        const nm = cleanName(b.name);
        if (nm.length < 2) return err("Name is too short.");
        this.sql.exec("UPDATE members SET name = ? WHERE id = ?", nm, viewer.id);
        // a number-only member who just picked a name joins this week
        if (!viewer.name) this.slotIn(viewer.id);
      }
      if (b.email !== undefined) {
        const e = String(b.email || "").trim().slice(0, 120);
        if (e && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(e)) return err("That doesn't look like an email address.");
        this.sql.exec("UPDATE members SET email = ? WHERE id = ?", e || null, viewer.id);
      }
      if (b.notify !== undefined) this.sql.exec("UPDATE members SET notify = ? WHERE id = ?", b.notify ? 1 : 0, viewer.id);
      if (b.bio !== undefined) this.sql.exec("UPDATE members SET bio = ? WHERE id = ?", String(b.bio).replace(/[<>]/g, "").slice(0, 140), viewer.id);
      if (b.active !== undefined) this.sql.exec("UPDATE members SET active = ? WHERE id = ?", b.active ? 1 : 0, viewer.id);
      if (Array.isArray(b.interests)) {
        const seen = new Set(), list = [];
        for (const raw of b.interests) {
          const t = String(raw).replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
          if (t && !seen.has(t.toLowerCase()) && list.length < 10) { seen.add(t.toLowerCase()); list.push(t); }
        }
        this.sql.exec("UPDATE members SET interests = ? WHERE id = ?", JSON.stringify(list), viewer.id);
      }
      return json(this.me(this.fresh(viewer)));
    }

    if (path.startsWith("/img/") && method === "GET") {
      const p = this.one("SELECT mime, data FROM photos WHERE id = ?", path.slice(5));
      if (!p) return new Response("not found", { status: 404 });
      return new Response(p.data, { headers: { "Content-Type": p.mime, "Cache-Control": "private, max-age=31536000, immutable" } });
    }

    // image upload: ?kind=avatar or ?kind=table&week=&gid=
    if (path === "/photo" && method === "POST") {
      const mime = (request.headers.get("Content-Type") || "").split(";")[0];
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return err("Photos only (JPEG, PNG or WebP).");
      const data = await request.arrayBuffer();
      if (!data.byteLength || data.byteLength > MAX_IMG) return err("That photo is too big.");
      const kind = url.searchParams.get("kind");
      const id = token().slice(0, 20);
      if (kind === "avatar") {
        const old = viewer.photo;
        this.sql.exec("INSERT INTO photos (id, mime, data, owner, created) VALUES (?, ?, ?, ?, ?)", id, mime, data, viewer.id, Date.now());
        this.sql.exec("UPDATE members SET photo = ?, no_photo = 0 WHERE id = ?", id, viewer.id);
        if (old) this.sql.exec("DELETE FROM photos WHERE id = ? AND week IS NULL", old);
      } else {
        const week = +url.searchParams.get("week"), gid = +url.searchParams.get("gid");
        const g = this.one("SELECT members FROM groups WHERE week = ? AND gid = ?", week, gid);
        if (!g || (!JSON.parse(g.members).includes(viewer.id) && !viewer.admin)) return err("Not your table.", 403);
        if ((this.one("SELECT COUNT(*) AS n FROM photos WHERE week = ? AND gid = ?", week, gid)?.n || 0) >= 6) return err("Six photos per table is the limit.");
        this.sql.exec("INSERT INTO photos (id, mime, data, owner, week, gid, created) VALUES (?, ?, ?, ?, ?, ?, ?)", id, mime, data, viewer.id, week, gid, Date.now());
      }
      return json(this.me(this.fresh(viewer)));
    }
    if (path === "/photo/delete" && method === "POST") {
      const { id } = await body();
      if (id === "avatar") {
        this.dropPhotos(viewer.id);
      } else {
        const p = this.one("SELECT owner FROM photos WHERE id = ?", id);
        if (!p || (p.owner !== viewer.id && !viewer.admin)) return err("Not your photo.", 403);
        this.sql.exec("DELETE FROM photos WHERE id = ?", id);
      }
      return json(this.me(this.fresh(viewer)));
    }

    // tick (or untick) a table, optionally with where you went
    if (path === "/done" && method === "POST") {
      const { week, gid, done, cafe } = await body();
      const g = this.one("SELECT * FROM groups WHERE week = ? AND gid = ?", +week, +gid);
      if (!g || (!JSON.parse(g.members).includes(viewer.id) && !viewer.admin)) return err("Not your table.", 403);
      const cf = cafe === undefined ? g.cafe : String(cafe).replace(/[<>]/g, "").slice(0, 60);
      if (done === undefined) this.sql.exec("UPDATE groups SET cafe = ? WHERE week = ? AND gid = ?", cf, +week, +gid);
      else if (done) this.sql.exec("UPDATE groups SET done_at = COALESCE(done_at, ?), done_by = COALESCE(done_by, ?), cafe = ? WHERE week = ? AND gid = ?", Date.now(), viewer.id, cf, +week, +gid);
      else this.sql.exec("UPDATE groups SET done_at = NULL, done_by = NULL WHERE week = ? AND gid = ?", +week, +gid);
      return json(this.me(this.fresh(viewer)));
    }

    // the table's WhatsApp group: someone makes it in WhatsApp and pastes the invite link here
    // your free hours for this group: slot keys "YYYY-MM-DD|HH" (New York time)
    if (path === "/avail" && method === "POST") {
      const { week, gid, slots } = await body();
      const g = this.one("SELECT members FROM groups WHERE week = ? AND gid = ?", +week, +gid);
      if (!g || !JSON.parse(g.members).includes(viewer.id)) return err("Not your group.", 403);
      const r = weekRange(+week);
      const clean = [...new Set((Array.isArray(slots) ? slots : []).map(String))]
        .filter((k) => /^\d{4}-\d{2}-\d{2}\|\d{2}$/.test(k) && k.slice(0, 10) >= r.start && k.slice(0, 10) <= r.end).slice(0, 400);
      this.sql.exec("INSERT INTO avail (week, gid, member, slots) VALUES (?, ?, ?, ?) ON CONFLICT(week, gid, member) DO UPDATE SET slots = excluded.slots", +week, +gid, viewer.id, JSON.stringify(clean));
      return json(this.me(this.fresh(viewer)));
    }
    // pick (or clear) the group's time and place; people who opted in get an email
    if (path === "/plan" && method === "POST") {
      const { week, gid, at, place } = await body();
      const g = this.one("SELECT * FROM groups WHERE week = ? AND gid = ?", +week, +gid);
      if (!g || (!JSON.parse(g.members).includes(viewer.id) && !viewer.admin)) return err("Not your group.", 403);
      if (!at) { this.sql.exec("UPDATE groups SET plan_at = NULL, plan_place = NULL, plan_by = NULL WHERE week = ? AND gid = ?", +week, +gid); return json(this.me(this.fresh(viewer))); }
      if (!/^\d{4}-\d{2}-\d{2}\|\d{2}$/.test(String(at))) return err("Pick a time from the grid.");
      const pl = String(place || "").replace(/[<>]/g, "").slice(0, 80);
      this.sql.exec("UPDATE groups SET plan_at = ?, plan_place = ?, plan_by = ?, cafe = CASE WHEN ? != '' THEN ? ELSE cafe END WHERE week = ? AND gid = ?", String(at), pl, viewer.id, pl, pl, +week, +gid);
      const mail = await this.mailPlan(+week, +gid);
      return json({ ...this.me(this.fresh(viewer)), mail });
    }

    if (path === "/chat" && method === "POST") {
      const { week, gid, link } = await body();
      const g = this.one("SELECT * FROM groups WHERE week = ? AND gid = ?", +week, +gid);
      if (!g || (!JSON.parse(g.members).includes(viewer.id) && !viewer.admin)) return err("Not your table.", 403);
      const l = String(link || "").trim();
      const m = l.match(/^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})\/?(?:\?.*)?$/);
      if (l && !m) return err("That doesn't look like a WhatsApp invite link (chat.whatsapp.com/...).");
      this.sql.exec("UPDATE groups SET chat = ?, chat_by = ? WHERE week = ? AND gid = ?", m ? "https://chat.whatsapp.com/" + m[1] : null, m ? viewer.id : null, +week, +gid);
      return json(this.me(this.fresh(viewer)));
    }

    // ---- organizer tools ----
    if (path.startsWith("/admin/")) {
      if (!viewer.admin) return err("Organizers only.", 403);
      if (path === "/admin/roster" && method === "GET") {
        return json({
          members: this.q("SELECT * FROM members WHERE removed = 0 ORDER BY name COLLATE NOCASE").map((m) => ({
            id: m.id, name: m.name, wa: m.wa, active: !!m.active, admin: !!m.admin,
            phone: m.phone ? "+" + m.phone : "", seen: m.seen,
            photo: m.photo ? `/api/coffee/img/${m.photo}` : m.jackson_photo || null,
          })),
        });
      }
      // merge `from` into `into`: number, sessions, photo, bio and interests move over if `into`
      // lacks them; `from` is swapped for `into` in every group (or dropped where both sit), then deleted
      if (path === "/admin/merge" && method === "POST") {
        const { from, into, name } = await body();
        const a = this.member(from), b = this.member(into);
        if (!a || !b || a.id === b.id) return err("Pick two different people.");
        if (a.admin) return err("Merge the other way round: the organizer's profile has to stay.");
        this.sql.exec(`UPDATE members SET phone = COALESCE(phone, ?), photo = COALESCE(photo, ?), bio = CASE WHEN bio = '' THEN ? ELSE bio END,
          interests = CASE WHEN interests = '[]' THEN ? ELSE interests END, seen = MAX(COALESCE(seen, 0), COALESCE(?, 0)), active = MAX(active, ?) WHERE id = ?`,
          a.phone, a.photo, a.bio || "", a.interests || "[]", a.seen, a.active, b.id);
        if (name) this.sql.exec("UPDATE members SET name = ? WHERE id = ?", cleanName(name), b.id);
        this.sql.exec("UPDATE sessions SET member = ? WHERE member = ?", b.id, a.id);
        this.sql.exec("UPDATE photos SET owner = ? WHERE owner = ?", b.id, a.id);
        const all = this.q("SELECT week, gid, members FROM groups");
        const intoWeeks = new Set(all.filter((g) => JSON.parse(g.members).includes(b.id)).map((g) => g.week));
        for (const g of all) {
          const ids = JSON.parse(g.members);
          if (!ids.includes(a.id)) continue;
          const next = intoWeeks.has(g.week) ? ids.filter((x) => x !== a.id) : ids.map((x) => (x === a.id ? b.id : x));
          this.sql.exec("UPDATE groups SET members = ?, done_by = CASE WHEN done_by = ? THEN ? ELSE done_by END WHERE week = ? AND gid = ?", JSON.stringify(next), a.id, b.id, g.week, g.gid);
        }
        this.sql.exec("DELETE FROM members WHERE id = ?", a.id);
        this.rebalance();
        return json({ ok: true });
      }
      if (path === "/admin/move" && method === "POST") {
        const { id, gid } = await body();
        const n = weekOf(), m = this.member(id), target = this.one("SELECT members FROM groups WHERE week = ? AND gid = ?", n, +gid);
        if (!m || !target) return err("No such person or group.");
        for (const g of this.q("SELECT gid, members FROM groups WHERE week = ?", n)) {
          const ids = JSON.parse(g.members);
          if (ids.includes(m.id) && g.gid !== +gid) this.sql.exec("UPDATE groups SET members = ? WHERE week = ? AND gid = ?", JSON.stringify(ids.filter((x) => x !== m.id)), n, g.gid);
        }
        const t = JSON.parse(target.members);
        if (!t.includes(m.id)) this.sql.exec("UPDATE groups SET members = ? WHERE week = ? AND gid = ?", JSON.stringify([...t, m.id]), n, +gid);
        return json({ ok: true });
      }
      if (path === "/admin/rebalance" && method === "POST") return json({ ok: true, moves: this.rebalance() });
      if (path === "/admin/duplicates" && method === "GET") {
        const ms = this.q("SELECT id, name, wa, phone, seen FROM members WHERE removed = 0 AND name != ''");
        const pairs = [];
        for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
          const A = ms[i], B = ms[j];
          const ta = slug(A.name).split("-").filter(Boolean), tb = slug(B.name).split("-").filter(Boolean);
          if (!ta.length || !tb.length || ta[0] !== tb[0]) continue;
          // same first name; then either one of them is a first name only ("Esther" vs "Esther Yang"),
          // or the surnames agree (an initial like "N." has to match the other surname's first letter)
          if (ta.length > 1 && tb.length > 1) {
            const la = ta[ta.length - 1], lb = tb[tb.length - 1];
            const same = la.length === 1 || lb.length === 1 ? la[0] === lb[0] : la === lb;
            if (!same) continue;
          }
          if (A.phone && B.phone) continue; // two linked numbers = two real people
          pairs.push([A, B].map((m) => ({ id: m.id, name: m.name, wa: m.wa, linked: !!m.phone, seen: !!m.seen })));
        }
        return json({ pairs });
      }
      if (path === "/admin/notify" && method === "GET") return json({ email: this.getMeta("notify_email") || "", ready: !!this.env.EMAIL });
      if (path === "/admin/notify" && method === "POST") {
        const { email } = await body();
        const e = String(email || "").trim();
        if (e && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(e)) return err("That doesn't look like an email address.");
        this.setMeta("notify_email", e);
        return json({ ok: true, email: e });
      }
      if (path === "/admin/notify/test" && method === "POST") return json(await this.notifyRound(weekOf(), "test"));
      if (path === "/admin/member" && method === "POST") {
        const b = await body();
        if (b.add) {
          const nm = cleanName(b.name);
          if (nm.length < 2) return err("Name is too short.");
          let id = slug(nm), k = 2;
          while (this.one("SELECT 1 AS x FROM members WHERE id = ?", id)) id = slug(nm) + "-" + k++;
          this.sql.exec("INSERT INTO members (id, name, wa, phone, joined) VALUES (?, ?, ?, ?, ?)", id, nm, nm, digits(b.phone) || null, Date.now());
          if (b.slot) this.slotIn(id);
          return json({ ok: true, id });
        }
        const m = this.member(b.id);
        if (!m) return err("No such member.", 404);
        if (b.name !== undefined) this.sql.exec("UPDATE members SET name = ? WHERE id = ?", cleanName(b.name), m.id);
        if (b.active !== undefined) this.sql.exec("UPDATE members SET active = ? WHERE id = ?", b.active ? 1 : 0, m.id);
        if (b.removePhoto) this.dropPhotos(m.id);
        if (b.setPhone !== undefined) {
          const d = typedPhone(b.setPhone);
          if (d.length < 7) return err("That number is too short.");
          const other = this.q("SELECT id, phone FROM members WHERE phone IS NOT NULL AND removed = 0 AND id != ?", m.id).find((x) => phoneMatch(x.phone, d));
          if (other) return err("That number is already linked to someone else.");
          this.sql.exec("UPDATE members SET phone = ? WHERE id = ?", d, m.id);
        }
        if (b.resetPhone) { this.sql.exec("UPDATE members SET phone = NULL WHERE id = ?", m.id); this.sql.exec("DELETE FROM sessions WHERE member = ?", m.id); }
        if (b.remove && !m.admin) {
          this.sql.exec("UPDATE members SET removed = 1, active = 0 WHERE id = ?", m.id);
          this.sql.exec("DELETE FROM sessions WHERE member = ?", m.id);
          // take them out of this round's group too (unless it already met), then even groups out
          const w = weekInfo();
          for (const g of this.q("SELECT gid, members, done_at FROM groups WHERE week = ?", w.n)) {
            const ids = JSON.parse(g.members);
            if (ids.includes(m.id) && !g.done_at && !w.over && !w.brk) this.sql.exec("UPDATE groups SET members = ? WHERE week = ? AND gid = ?", JSON.stringify(ids.filter((x) => x !== m.id)), w.n, g.gid);
          }
          this.rebalance();
        }
        return json({ ok: true });
      }
      // redo this week's tables (keeps nothing from the old draw)
      if (path === "/admin/reshuffle" && method === "POST") {
        const n = weekOf();
        this.sql.exec("DELETE FROM photos WHERE week = ?", n);
        this.sql.exec("DELETE FROM groups WHERE week = ?", n);
        this.ensureWeek(n, Date.now() % 100000);
        this.ctx.waitUntil(this.notifyRound(n, "reshuffled"));
        return json(this.me(this.fresh(viewer)));
      }
    }
    return err("not found", 404);
  }
}
