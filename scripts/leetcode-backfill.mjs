#!/usr/bin/env node
// One-time import of every LeetCode problem you've solved.
//
//   node scripts/leetcode-backfill.mjs
//
// LeetCode only lists solved problems to the logged-in owner, so this asks for
// your LEETCODE_SESSION cookie in a hidden prompt (or reads it from the
// LEETCODE_SESSION env var). The cookie is used for these requests only — it is
// never written to disk or printed.
//
// Output: data/leetcode-solved.json (problem slugs, titles, difficulty, date).
// After this, the daily fetch keeps the file current from your public recent
// submissions, so you shouldn't need to run it again.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/leetcode-solved.json");
const config = JSON.parse(await readFile(resolve(ROOT, "config.json"), "utf8"));

function promptHidden(question) {
  return new Promise((done) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) { // piped input
      let s = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (c) => (s += c)).on("end", () => done(s.trim()));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let s = "";
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          stdout.write("\n");
          return done(s.trim());
        }
        if (c === "\u0003") { stdout.write("\n"); process.exit(130); } // Ctrl+C
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
        else s += c;
      }
    };
    stdin.on("data", onData);
  });
}

let session = process.env.LEETCODE_SESSION;
if (!session) {
  console.log("Paste your LEETCODE_SESSION cookie (input is hidden), then press Enter.");
  session = await promptHidden("> ");
}
// The cookie value is a JWT ("eyJ….….…"). Pull it out of whatever was pasted —
// a copied table row, "LEETCODE_SESSION=…;", or terminal paste escape codes.
const raw = session || "";
const jwt = raw.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
if (!jwt) {
  console.error(
    `That doesn't look like a LEETCODE_SESSION value (got ${raw.trim().length} characters).\n`
    + `It should be one long string that starts with "eyJ" and contains two dots.\n`
    + `In DevTools, click the LEETCODE_SESSION row and copy the full value shown in the panel below the table.`,
  );
  process.exit(1);
}
session = jwt[0];

// The middle part of the JWT is readable JSON — use it to give a useful hint
// (account name and expiry only; the cookie itself is never printed).
let claims = {};
try { claims = JSON.parse(Buffer.from(session.split(".")[1], "base64url").toString("utf8")); } catch {}
const expSec = claims.expired_time_ ?? claims.exp;
console.log(`Cookie looks valid: ${session.length} characters${claims.username ? `, account "${claims.username}"` : ""}`
  + `${expSec ? `, expires ${new Date(expSec * 1000).toISOString().slice(0, 10)}` : ""}.`);
if (expSec && expSec * 1000 < Date.now()) {
  console.error("This cookie has already expired. Refresh leetcode.com (log in again if needed) and copy the new value.");
  process.exit(1);
}

// Django CSRF only checks that header and cookie match, so a random token works.
const csrf = randomBytes(16).toString("hex");
async function gql(query, variables = {}) {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://leetcode.com/problemset/",
      Origin: "https://leetcode.com",
      Cookie: `LEETCODE_SESSION=${session}; csrftoken=${csrf}`,
      "x-csrftoken": csrf,
      "User-Agent": "Mozilla/5.0 (personal-website leetcode backfill)",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Confirm the cookie works.
const { userStatus } = await gql(`{ userStatus { isSignedIn username } }`);
if (!userStatus?.isSignedIn) {
  console.error(
    "LeetCode says you're not signed in with this cookie. Usually that means:\n"
    + "  • it was copied from a tab that's logged out, or from leetcode.cn instead of leetcode.com\n"
    + "  • you logged out (or LeetCode rotated the session) after copying it\n"
    + "Reload leetcode.com, confirm your avatar is in the top-right, then copy LEETCODE_SESSION again.",
  );
  process.exit(1);
}
console.log(`Signed in as ${userStatus.username}.`);
if (config.handles.leetcode && config.handles.leetcode.toLowerCase() !== userStatus.username.toLowerCase()) {
  console.warn(`Warning: config.json has LeetCode handle "${config.handles.leetcode}" but the cookie belongs to "${userStatus.username}".`);
}

// 2. Page through solved problems. Prefer the progress list (it has dates);
//    fall back to the problem-set list with an "accepted" filter.
const problems = new Map();
async function viaProgressList() {
  const q = `query($filters: UserProgressQuestionListInput) {
    userProgressQuestionList(filters: $filters) {
      totalNum
      questions { title titleSlug difficulty lastSubmittedAt questionStatus lastResult }
    }
  }`;
  for (let skip = 0; ; skip += 50) {
    const { userProgressQuestionList: page } = await gql(q, { filters: { skip, limit: 50 } });
    for (const x of page.questions) {
      if (x.questionStatus !== "SOLVED") continue;
      const t = x.lastSubmittedAt ? Math.floor(new Date(x.lastSubmittedAt).getTime() / 1000) : null;
      problems.set(x.titleSlug, { slug: x.titleSlug, title: x.title, difficulty: cap(x.difficulty), t });
    }
    process.stdout.write(`\r  ${Math.min(skip + 50, page.totalNum)} / ${page.totalNum} attempted problems scanned`);
    if (skip + 50 >= page.totalNum) break;
    await sleep(400);
  }
  process.stdout.write("\n");
}
async function viaProblemset() {
  const q = `query($skip: Int, $limit: Int, $filters: QuestionListFilterInput) {
    questionList(categorySlug: "", skip: $skip, limit: $limit, filters: $filters) {
      totalNum
      data { title titleSlug difficulty status }
    }
  }`;
  for (let skip = 0; ; skip += 100) {
    const { questionList: page } = await gql(q, { skip, limit: 100, filters: { status: "AC" } });
    for (const x of page.data) problems.set(x.titleSlug, { slug: x.titleSlug, title: x.title, difficulty: cap(x.difficulty), t: null });
    process.stdout.write(`\r  ${problems.size} / ${page.totalNum} solved problems`);
    if (skip + 100 >= page.totalNum) break;
    await sleep(400);
  }
  process.stdout.write("\n");
}
const cap = (d) => (d ? d[0].toUpperCase() + d.slice(1).toLowerCase() : null);

try {
  await viaProgressList();
} catch (err) {
  console.log(`  progress list unavailable (${err.message}); trying the problem-set list…`);
  problems.clear();
  await viaProblemset();
}

// 3. Keep anything already in the file (e.g. dates from earlier runs).
try {
  const prev = JSON.parse(await readFile(OUT, "utf8"));
  for (const p of prev.problems || []) {
    const cur = problems.get(p.slug);
    if (!cur) problems.set(p.slug, p);
    else if (cur.t == null) cur.t = p.t;
  }
} catch {}

const list = [...problems.values()].sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || a.slug.localeCompare(b.slug));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ username: userStatus.username, updatedAt: new Date().toISOString(), problems: list }, null, 1) + "\n");
const by = list.reduce((a, p) => ((a[p.difficulty] = (a[p.difficulty] || 0) + 1), a), {});
console.log(`Saved ${list.length} solved problems (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ")}) to data/leetcode-solved.json`);
console.log("Next: run  node scripts/fetch-cp-data.mjs  to rebuild the charts.");
