// Home page: plain lists of research and projects (from content/*.json)
// and a one-line competitive-programming summary (from data/cp.json).
(() => {
  "use strict";
  const { esc, getJSON } = window.site;
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const title = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase()); // "master" -> "Master"

  const entry = ({ href, name, meta, desc }) => `
    <li>
      <div class="entry-head"><a class="entry-title" href="${esc(href)}">${esc(name)}</a><span class="entry-meta">${esc(meta)}</span></div>
      ${desc ? `<p class="entry-desc">${esc(desc)}</p>` : ""}
    </li>`;

  const researchMeta = (r) => {
    const status = (r.type || "").match(/^(Ongoing|Completed) research · /i);
    const where = (r.type || "").replace(/^(Ongoing|Completed) research · /i, "").replace(/^Independent research$/i, "Independent");
    return [status ? status[1] : null, where, r.year].filter(Boolean).join(" · ");
  };

  function cpLine(cp) {
    const parts = [];
    if (cp.codeforces) parts.push(`Codeforces <b>${esc(title(cp.codeforces.rank))}</b> (${fmt(cp.codeforces.rating)})`);
    if (cp.leetcode) parts.push(`LeetCode <b>${esc(cp.leetcode.badge || "")}</b> (${fmt(cp.leetcode.rating)})`);
    parts.push(`<b>${fmt(cp.totalSolved)}</b> problems solved`);
    return `${parts.join(" · ")}. <a href="competitive-programming.html">Ratings, activity and progress</a>.`;
  }

  Promise.all([
    getJSON("content/research.json").catch(() => []),
    getJSON("content/projects.json").catch(() => []),
    getJSON("data/cp.json").catch(() => null),
  ]).then(([research, projects, cp]) => {
    document.getElementById("home-research").innerHTML = research.map((r) =>
      entry({ href: `research.html#${r.id}`, name: r.title, meta: researchMeta(r), desc: r.tagline })).join("");
    document.getElementById("home-projects").innerHTML = projects.map((p) =>
      entry({ href: `projects.html#${p.id}`, name: p.title, meta: p.status || "", desc: p.subtitle })).join("");
    if (cp) document.getElementById("home-cp").innerHTML = cpLine(cp);
  });
})();
