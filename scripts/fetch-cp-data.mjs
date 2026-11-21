#!/usr/bin/env node
// Fetches competitive-programming stats and writes data/cp.json.
// No dependencies — needs Node 18+ (built-in fetch).
//
//   node scripts/fetch-cp-data.mjs
//
// Handles come from config.json; override any of them for a quick test with
// CF_HANDLE / ATCODER_HANDLE / LEETCODE_HANDLE env vars, and redirect the
// output with OUT=path/to/file.json.
//
// If a platform fails to fetch, its previous data in data/cp.json is kept so a
// flaky API never wipes the site.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, process.env.OUT || "data/cp.json");
const config = JSON.parse(await readFile(resolve(ROOT, "config.json"), "utf8"));
const handles = {
  codeforces: process.env.CF_HANDLE ?? config.handles.codeforces,
  atcoder: process.env.ATCODER_HANDLE ?? config.handles.atcoder,
  leetcode: process.env.LEETCODE_HANDLE ?? config.handles.leetcode,
};
const TZ = config.timezone || "UTC";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "personal-website-cp-stats (github actions)";

async function getJSON(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip", ...(init.headers || {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(2000 * attempt);
    }
  }
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// "YYYY-MM-DD" for a unix-seconds timestamp, in the configured timezone.
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (sec) => dayFmt.format(new Date(sec * 1000));

function bump(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}

// Canonical keys so the same problem linked from different places counts once.
function problemKey(url) {
  if (!url) return null;
  let m;
  if ((m = url.match(/cses\.fi\/problemset\/task\/(\d+)/))) return `cses:${m[1]}`;
  if ((m = url.match(/codeforces\.com\/(?:contest|gym)\/(\d+)\/problem\/(\w+)/))) return `cf:${m[1]}${m[2]}`;
  if ((m = url.match(/codeforces\.com\/problemset\/problem\/(\d+)\/(\w+)/))) return `cf:${m[1]}${m[2]}`;
  if ((m = url.match(/atcoder\.jp\/contests\/[^/]+\/tasks\/(\w+)/))) return `ac:${m[1]}`;
  if ((m = url.match(/usaco\.org\/.*cpid=(\d+)/))) return `usaco:${m[1]}`;
  return url.trim().replace(/\/+$/, "");
}

// ---------------------------------------------------------------- Codeforces
async function fetchCodeforces(handle) {
  const api = "https://codeforces.com/api";
  const [info] = (await getJSON(`${api}/user.info?handles=${encodeURIComponent(handle)}`)).result;
  await sleep(2100); // CF asks for at most one call per 2s
  const rating = (await getJSON(`${api}/user.rating?handle=${encodeURIComponent(handle)}`)).result;
  await sleep(2100);
  const subs = (await getJSON(`${api}/user.status?handle=${encodeURIComponent(handle)}`)).result;

  const firstAC = new Map(); // key -> {t, rating, tags}
  for (const s of subs) {
    if (s.verdict !== "OK") continue;
    const p = s.problem;
    const key = `cf:${p.contestId ?? p.problemsetName}${p.index}`;
    const prev = firstAC.get(key);
    if (!prev || s.creationTimeSeconds < prev.t) {
      firstAC.set(key, { t: s.creationTimeSeconds, rating: p.rating ?? null, tags: p.tags || [] });
    }
  }

  const daily = {};
  const byRating = {};
  const tags = {};
  for (const { t, rating: r, tags: tg } of firstAC.values()) {
    bump(daily, dayOf(t));
    bump(byRating, r ? String(r) : "unrated");
    for (const x of tg) bump(tags, x);
  }

  return {
    handle: info.handle,
    url: `https://codeforces.com/profile/${info.handle}`,
    rating: info.rating ?? null,
    maxRating: info.maxRating ?? null,
    rank: info.rank ?? "unrated",
    maxRank: info.maxRank ?? "unrated",
    contests: rating.map((c) => ({
      name: c.contestName,
      url: `https://codeforces.com/contest/${c.contestId}`,
      t: c.ratingUpdateTimeSeconds,
      rating: c.newRating,
      delta: c.newRating - c.oldRating,
      place: c.rank,
    })),
    solved: firstAC.size,
    solvedByRating: byRating,
    tags,
    daily,
    _keys: [...firstAC.keys()],
    _rated: [...firstAC].map(([key, v]) => ({ key, rating: v.rating })),
  };
}

// ------------------------------------------------------------------- AtCoder
async function fetchAtCoder(handle) {
  const history = await getJSON(`https://atcoder.jp/users/${encodeURIComponent(handle)}/history/json`);
  const rated = history.filter((c) => c.IsRated);

  // Submissions via the community AtCoder Problems API (kenkoooo), 500 per page.
  const kapi = "https://kenkoooo.com/atcoder/atcoder-api/v3";
  const firstAC = new Map();
  let from = 0;
  for (let page = 0; page < 200; page++) {
    const batch = await getJSON(`${kapi}/user/submissions?user=${encodeURIComponent(handle)}&from_second=${from}`);
    for (const s of batch) {
      if (s.result !== "AC") continue;
      const key = `ac:${s.problem_id}`;
      const prev = firstAC.get(key);
      if (!prev || s.epoch_second < prev) firstAC.set(key, s.epoch_second);
    }
    if (batch.length < 500) break;
    from = Math.max(...batch.map((s) => s.epoch_second)) + 1;
    await sleep(1100);
  }

  const daily = {};
  for (const t of firstAC.values()) bump(daily, dayOf(t));

  // Problem difficulties (AtCoder scale) from AtCoder Problems' model, converted
  // to a Codeforces-equivalent estimate.
  let models = {};
  try { models = await getJSON("https://kenkoooo.com/atcoder/resources/problem-models.json"); } catch {}
  const _rated = [...firstAC.keys()].map((key) => ({ key, rating: atcoderToCF(models[key.slice(3)]?.difficulty) }));

  const last = rated.at(-1);
  return {
    handle,
    url: `https://atcoder.jp/users/${handle}`,
    rating: last ? last.NewRating : null,
    maxRating: rated.length ? Math.max(...rated.map((c) => c.NewRating)) : null,
    contests: rated.map((c) => ({
      name: c.ContestNameEn || c.ContestName,
      url: `https://atcoder.jp/contests/${c.ContestScreenName.split(".")[0]}`,
      t: Math.floor(new Date(c.EndTime).getTime() / 1000),
      rating: c.NewRating,
      delta: c.NewRating - c.OldRating,
      performance: c.Performance,
      place: c.Place,
    })),
    solved: firstAC.size,
    daily,
    _keys: [...firstAC.keys()],
    _rated,
  };
}

// AtCoder difficulty -> Codeforces-equivalent rating (rough estimate).
// Low difficulties are first un-clipped the way AtCoder Problems displays them,
// then mapped linearly using rank-tier anchors (AtCoder green 800 ≈ CF 1200,
// blue 1600 ≈ CF 1800, orange 2400 ≈ CF 2400), clamped to CF's 800–3500 range.
function atcoderToCF(d) {
  if (d == null) return null;
  if (d < 400) d = 400 / Math.exp((400 - d) / 400);
  return Math.min(3500, Math.max(800, Math.round((0.75 * d + 600) / 100) * 100));
}

// ------------------------------------------------------------------ LeetCode
async function leetcodeQuery(query, variables) {
  const body = await getJSON("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: "https://leetcode.com" },
    body: JSON.stringify({ query, variables }),
  });
  if (body.errors?.length) throw new Error(`LeetCode: ${body.errors[0].message}`);
  return body.data;
}

async function fetchLeetCode(handle) {
  const base = await leetcodeQuery(
    `query($u: String!) {
      matchedUser(username: $u) {
        username
        submitStatsGlobal { acSubmissionNum { difficulty count } }
        userCalendar { activeYears }
      }
      userContestRanking(username: $u) { rating attendedContestsCount topPercentage badge { name } }
      userContestRankingHistory(username: $u) { attended rating ranking contest { title startTime } }
    }`,
    { u: handle },
  );
  if (!base.matchedUser) throw new Error(`LeetCode user "${handle}" not found`);

  // The calendar is per-year; LeetCode buckets submissions by UTC day.
  const daily = {};
  for (const year of base.matchedUser.userCalendar.activeYears || []) {
    const d = await leetcodeQuery(
      `query($u: String!, $y: Int) { matchedUser(username: $u) { userCalendar(year: $y) { submissionCalendar } } }`,
      { u: handle, y: year },
    );
    const cal = JSON.parse(d.matchedUser.userCalendar.submissionCalendar || "{}");
    for (const [sec, n] of Object.entries(cal)) bump(daily, new Date(Number(sec) * 1000).toISOString().slice(0, 10), n);
    await sleep(800);
  }

  const ac = Object.fromEntries(base.matchedUser.submitStatsGlobal.acSubmissionNum.map((x) => [x.difficulty.toLowerCase(), x.count]));
  const contests = (base.userContestRankingHistory || []).filter((c) => c.attended);
  const rank = base.userContestRanking;
  let prev = 1500; // LeetCode's starting rating
  return {
    handle: base.matchedUser.username,
    url: `https://leetcode.com/u/${base.matchedUser.username}/`,
    rating: rank ? Math.round(rank.rating) : null,
    maxRating: contests.length ? Math.round(Math.max(...contests.map((c) => c.rating))) : null,
    topPercentage: rank?.topPercentage ?? null,
    badge: rank?.badge?.name ?? null,
    contests: contests.map((c) => {
      const r = Math.round(c.rating);
      const out = { name: c.contest.title, t: c.contest.startTime, rating: r, delta: r - prev, place: c.ranking };
      prev = r;
      return out;
    }),
    solved: ac.all ?? 0,
    solvedByDifficulty: { easy: ac.easy ?? 0, medium: ac.medium ?? 0, hard: ac.hard ?? 0 },
    daily, // NOTE: submissions per day, not unique solves (LeetCode does not expose the latter publicly)
    _rated: await leetcodeRatedProblems(base.matchedUser.username),
  };
}

// Per-problem list from data/leetcode-solved.json (created once by
// scripts/leetcode-backfill.mjs), topped up with the public "recent 20 accepted"
// list on every run. Ratings come from zerotrac's LeetCode contest-problem
// ratings; problems that never appeared in a contest stay unrated.
const LC_STORE = resolve(ROOT, "data/leetcode-solved.json");
async function leetcodeRatedProblems(username) {
  let store;
  try { store = JSON.parse(await readFile(LC_STORE, "utf8")); } catch { return undefined; }
  if (store.username?.toLowerCase() !== username.toLowerCase()) return undefined;

  const bySlug = new Map(store.problems.map((p) => [p.slug, p]));
  const { recentAcSubmissionList: recent } = await leetcodeQuery(
    `query($u: String!) { recentAcSubmissionList(username: $u, limit: 20) { title titleSlug timestamp } }`,
    { u: username },
  );
  let added = 0;
  for (const r of recent || []) {
    if (bySlug.has(r.titleSlug)) continue;
    const { question } = await leetcodeQuery(`query($s: String!) { question(titleSlug: $s) { difficulty } }`, { s: r.titleSlug });
    bySlug.set(r.titleSlug, { slug: r.titleSlug, title: r.title, difficulty: question?.difficulty ?? null, t: Number(r.timestamp) });
    added++;
    await sleep(300);
  }
  if (added) {
    store.problems = [...bySlug.values()].sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || a.slug.localeCompare(b.slug));
    store.updatedAt = new Date().toISOString();
    await writeFile(LC_STORE, JSON.stringify(store, null, 1) + "\n");
  }

  const ratings = new Map();
  try {
    const tsv = await getText("https://raw.githubusercontent.com/zerotrac/leetcode_problem_rating/main/ratings.txt");
    for (const line of tsv.split("\n").slice(1)) {
      const cols = line.split("\t");
      if (cols[4]) ratings.set(cols[4].trim(), parseFloat(cols[0]));
    }
  } catch {}
  return [...bySlug.values()].map((p) => ({ key: `lc:${p.slug}`, rating: leetcodeToCF(ratings.get(p.slug)) }));
}

// zerotrac rating (LeetCode contest scale) -> Codeforces-equivalent (rough):
// LeetCode contest ratings run ~400 above Codeforces for the same skill.
function leetcodeToCF(r) {
  if (r == null || !Number.isFinite(r)) return null;
  return Math.min(3500, Math.max(800, Math.round((r - 400) / 100) * 100));
}

// --------------------------------------------------------------- Spreadsheet
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

async function fetchSheetTab(id, tab) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const rows = parseCSV(await getText(url)).filter((r) => r.NAME);
  const categories = [];
  const index = new Map();
  const solvedKeys = [];
  const rated = [];
  for (const r of rows) {
    const name = r.CATEGORY || "Other";
    if (!index.has(name)) { index.set(name, { name, solved: 0, total: 0 }); categories.push(index.get(name)); }
    const c = index.get(name);
    c.total++;
    if (/^y(es)?$/i.test(r.SOLVE)) {
      c.solved++;
      const key = problemKey(r.LINK);
      if (key) solvedKeys.push(key);
      const n = parseInt(r["Rating (CF estimate)"], 10);
      rated.push({ key: key || r.NAME, rating: Number.isFinite(n) ? n : null });
    }
  }
  return {
    name: tab,
    solved: categories.reduce((a, c) => a + c.solved, 0),
    total: rows.length,
    categories,
    _keys: solvedKeys,
    _rated: rated,
  };
}

async function fetchSheet() {
  const { id, cses, usacoGuide } = config.spreadsheet;
  const csesTab = await fetchSheetTab(id, cses);
  const tiers = [];
  for (const tab of usacoGuide) tiers.push(await fetchSheetTab(id, tab));
  return {
    cses: csesTab,
    usacoGuide: {
      solved: tiers.reduce((a, t) => a + t.solved, 0),
      total: tiers.reduce((a, t) => a + t.total, 0),
      tiers: tiers.map((t) => ({ ...t, name: t.name.replace(/^USACO\s+/i, "") })),
    },
  };
}

// ---------------------------------------------------------------------- main
let previous = {};
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch {}

const out = { updatedAt: new Date().toISOString(), timezone: TZ, errors: {} };
const jobs = {
  codeforces: () => fetchCodeforces(handles.codeforces),
  atcoder: () => fetchAtCoder(handles.atcoder),
  leetcode: () => fetchLeetCode(handles.leetcode),
  sheet: () => fetchSheet(),
};
const keysByPlatform = {};

for (const [name, job] of Object.entries(jobs)) {
  if (name !== "sheet" && !handles[name]) { out[name] = null; continue; }
  try {
    process.stdout.write(`Fetching ${name}… `);
    out[name] = await job();
    console.log("ok");
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    out.errors[name] = err.message;
    out[name] = previous[name] ?? null;
  }
}

// Unique-problem total: union of known problem keys, plus LeetCode's count
// (LeetCode's per-problem list isn't public, so it can't be de-duplicated).
const keys = new Set();
for (const k of out.codeforces?._keys || []) keys.add(k);
for (const k of out.atcoder?._keys || []) keys.add(k);
for (const k of out.sheet?.cses?._keys || []) keys.add(k);
for (const t of out.sheet?.usacoGuide?.tiers || []) for (const k of t._keys || []) keys.add(k);
out.totalSolved = keys.size + (out.leetcode?.solved || 0);
// A fallback platform has no key list, so the union would undercount — keep the last good total.
if (Object.keys(out.errors).length && previous.totalSolved > out.totalSolved) out.totalSolved = previous.totalSolved;

// Solved problems bucketed by Codeforces(-equivalent) rating, by source.
// Each problem counts once: a sheet row linking to a Codeforces/AtCoder problem
// you've solved there is counted under that platform, not the sheet.
// LeetCode joins once data/leetcode-solved.json exists (see leetcode-backfill.mjs).
function ratingDistribution() {
  const buckets = {}, unrated = {}, seen = new Set();
  const add = (source, { key, rating }) => {
    if (seen.has(key)) return;
    seen.add(key);
    if (rating == null) return bump(unrated, source);
    const b = String(Math.min(3500, Math.max(800, Math.round(rating / 100) * 100)));
    bump((buckets[b] ||= {}), source);
  };
  for (const p of out.codeforces?._rated || []) add("codeforces", p);
  for (const p of out.atcoder?._rated || []) add("atcoder", p);
  for (const p of out.leetcode?._rated || []) add("leetcode", p);
  for (const p of out.sheet?.cses?._rated || []) add("sheet", p);
  for (const t of out.sheet?.usacoGuide?.tiers || []) for (const p of t._rated || []) add("sheet", p);
  return { buckets, unrated, includesLeetCode: Boolean(out.leetcode?._rated) };
}
// A platform that fell back to old data has no problem list — keep the last good chart.
out.ratingDistribution = !Object.keys(out.errors).length || !previous.ratingDistribution
  ? ratingDistribution()
  : previous.ratingDistribution;

// Drop the internal key lists before writing.
const strip = (o) => o && Object.fromEntries(Object.entries(o).filter(([k]) => k !== "_keys" && k !== "_rated"));
for (const p of ["codeforces", "atcoder", "leetcode"]) out[p] = strip(out[p]);
if (out.sheet) {
  out.sheet.cses = strip(out.sheet.cses);
  out.sheet.usacoGuide.tiers = out.sheet.usacoGuide.tiers.map(strip);
}
if (!Object.keys(out.errors).length) delete out.errors;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${OUT} — ${out.totalSolved} unique problems solved.`);
