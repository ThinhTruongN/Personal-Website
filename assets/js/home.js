// Home page: live stat strip + promo tiles for research, projects and CP.
(() => {
  "use strict";
  const { esc, getJSON } = window.site;
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const title = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase()); // "master" -> "Master"

  function activeDaysPastYear(cp) {
    const today = new Date().toISOString().slice(0, 10);
    const yearAgo = new Date(Date.now() - 364 * 86400000).toISOString().slice(0, 10);
    const days = new Set();
    for (const p of ["codeforces", "atcoder", "leetcode"]) {
      for (const [d, n] of Object.entries(cp[p]?.daily || {})) if (n > 0 && d >= yearAgo && d <= today) days.add(d);
    }
    return days.size;
  }

  function statStrip(cp) {
    const items = [
      [fmt(cp.totalSolved), "problems solved"],
      [fmt(cp.codeforces?.rating), `Codeforces · ${esc(title(cp.codeforces?.rank))}`],
      [fmt(cp.leetcode?.rating), `LeetCode · ${esc(cp.leetcode?.badge || "contest rating")}`],
      [fmt(activeDaysPastYear(cp)), "active days this year"],
    ];
    return `<div class="stat-strip reveal">${items.map(([v, l]) => `<div><div class="v">${v}</div><div class="l">${l}</div></div>`).join("")}</div>`;
  }

  // Codeforces rating sparkline (blue = Codeforces), with an area wash and end label.
  function sparkline(contests) {
    if (!contests?.length) return "";
    const W = 760, H = 150, pad = { l: 8, r: 8, t: 10, b: 10 };
    const t0 = contests[0].t, t1 = contests.at(-1).t || t0 + 1;
    const rs = contests.map((c) => c.rating);
    const lo = Math.min(...rs), hi = Math.max(...rs);
    const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
    const pts = contests.map((c) => `${x(c.t).toFixed(1)},${y(c.rating).toFixed(1)}`);
    const last = contests.at(-1);
    return `<div class="promo-spark"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Codeforces rating over ${contests.length} contests, now ${last.rating}">
      <path d="M${pts[0]} L${pts.join(" L")} L${x(last.t)},${H} L${x(t0)},${H} Z" fill="var(--cf)" opacity="0.1"/>
      <path d="M${pts.join(" L")}" fill="none" stroke="var(--cf)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(last.t)}" cy="${y(last.rating)}" r="5" fill="var(--cf)" stroke="var(--surface)" stroke-width="2"/>
    </svg>
    <p class="spark-caption"><span class="swatch" style="background:var(--cf)"></span>Codeforces rating · ${fmt(last.rating)} now, across ${contests.length} contests</p></div>`;
  }

  const plate = (src, alt) => `<div class="promo-visual"><div class="plate"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></div></div>`;

  function researchPromo(r) {
    const fig = r.figures?.[0];
    const visual = fig ? plate(fig.src, fig.alt || fig.caption) : r.compare ? window.site.compareBars(r.compare) : "";
    return `<a class="promo wide${fig ? "" : " compact"} reveal" href="research.html#${esc(r.id)}">
      <p class="eyebrow">${/ongoing/i.test(r.type || "") ? "Research · Ongoing" : "Research"}</p>
      <h3>${esc(r.title)}</h3>
      <p>${esc(r.tagline || "")}</p>
      <span class="more">${!r.pdf ? "Learn more" : /ongoing/i.test(r.type || "") ? "Read the draft" : "Read the paper"}</span>
      ${visual}
    </a>`;
  }

  function projectPromo(p, i, all) {
    const v = p.visual;
    const visual = v?.type === "pendulum" ? `<div class="promo-visual">${window.site.pendulumSVG}</div>`
      : v?.type === "scheduler" ? `<div class="promo-visual">${window.site.schedulerSVG}</div>`
      : v?.type === "image" ? plate(v.src, v.alt || p.title) : "";
    // tiles sit two per row; an odd one out at the end spans the full width
    const wide = all.length % 2 === 1 && i === all.length - 1;
    return `<a class="promo${wide ? " wide compact" : ""} reveal" href="projects.html#${esc(p.id)}">
      <p class="eyebrow">Project${p.status ? ` · ${esc(p.status)}` : ""}</p>
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.subtitle || "")}</p>
      <span class="more">Learn more</span>
      ${visual}
    </a>`;
  }

  function cpPromo(cp) {
    const bits = [
      cp.codeforces && `Codeforces ${esc(title(cp.codeforces.rank))}`,
      cp.leetcode?.badge && `LeetCode ${esc(cp.leetcode.badge)}`,
      "updated daily",
    ].filter(Boolean);
    return `<a class="promo wide compact reveal" href="competitive-programming.html">
      <p class="eyebrow">Competitive Programming</p>
      <h3>${fmt(cp.totalSolved)} problems solved.</h3>
      <p>${bits.join(" · ")}</p>
      <span class="more">View the dashboard</span>
      ${sparkline(cp.codeforces?.contests)}
    </a>`;
  }

  Promise.all([
    getJSON("data/cp.json").catch(() => null),
    getJSON("content/projects.json").catch(() => []),
    getJSON("content/research.json").catch(() => []),
  ]).then(([cp, projects, research]) => {
    if (cp) {
      const strip = document.getElementById("home-stats");
      strip.innerHTML = statStrip(cp);
      window.site.reveal(strip);
    }
    const promos = document.getElementById("home-promos");
    promos.innerHTML = [
      ...research.map(researchPromo),
      ...projects.map(projectPromo),
      cp ? cpPromo(cp) : "",
    ].join("");
    window.site.reveal(promos);
  });
})();
