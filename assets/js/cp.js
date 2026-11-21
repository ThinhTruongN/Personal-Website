// Competitive-programming section: reads data/cp.json (written by
// scripts/fetch-cp-data.mjs) and draws tiles, rating charts, the activity
// heatmap and curriculum progress. Plain SVG, no dependencies.
(() => {
  "use strict";

  const PLATFORMS = [
    { id: "codeforces", name: "Codeforces", color: "--cf", unit: "solved" },
    { id: "atcoder", name: "AtCoder", color: "--ac", unit: "solved" },
    { id: "leetcode", name: "LeetCode", color: "--lc", unit: "submissions" },
  ];
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------------------------------------------------------- date utils
  // Days are "YYYY-MM-DD" strings; arithmetic happens in UTC so it never drifts.
  const toUTC = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (d, n) => fromUTC(toUTC(d) + n * 86400000);
  const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const prettyDay = (d) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`;
  const prettyTime = (sec) => new Date(sec * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  // ---------------------------------------------------------- tooltip
  const tip = $("tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  window.addEventListener("scroll", hideTip, { passive: true });

  // ---------------------------------------------------------- scales
  function niceStep(span, target) {
    const raw = span / target;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const m = raw / pow;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * pow;
  }
  function niceTicks(min, max, target = 5) {
    if (min === max) { min -= 50; max += 50; }
    const step = niceStep(max - min, target);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
    return { lo, hi, ticks };
  }

  // ---------------------------------------------------------- theme
  function initTheme(onChange) {
    $("theme-toggle").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme
        || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch {}
      onChange();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
  }

  // ---------------------------------------------------------- activity model
  function buildActivity(data) {
    const days = {}; // day -> { codeforces, atcoder, leetcode }
    for (const p of PLATFORMS) {
      for (const [d, n] of Object.entries(data[p.id]?.daily || {})) {
        (days[d] ||= {})[p.id] = n;
      }
    }
    return days;
  }
  const dayTotal = (entry, filter) =>
    !entry ? 0 : filter === "all" ? PLATFORMS.reduce((a, p) => a + (entry[p.id] || 0), 0) : entry[filter] || 0;

  function streaks(days, today) {
    const active = Object.keys(days).filter((d) => dayTotal(days[d], "all") > 0).sort();
    if (!active.length) return { current: 0, longest: 0, activeYear: 0 };
    let longest = 1, run = 1;
    for (let i = 1; i < active.length; i++) {
      run = active[i] === addDays(active[i - 1], 1) ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    // A streak is still alive if you practiced yesterday but not yet today.
    let current = 0;
    let d = dayTotal(days[today], "all") > 0 ? today : addDays(today, -1);
    while (dayTotal(days[d], "all") > 0) { current++; d = addDays(d, -1); }
    const yearAgo = addDays(today, -364);
    const activeYear = active.filter((x) => x >= yearAgo && x <= today).length;
    return { current, longest, activeYear };
  }

  // ---------------------------------------------------------- tiles
  function renderTiles(data, days, today) {
    const s = streaks(days, today);
    const tiles = [
      { label: "Problems solved", value: fmt(data.totalSolved), note: "Unique, across all platforms", hero: true },
      { label: "Current streak", value: `${s.current} ${s.current === 1 ? "day" : "days"}`, note: "Consecutive active days" },
      { label: "Longest streak", value: `${s.longest} ${s.longest === 1 ? "day" : "days"}`, note: "All time" },
      { label: "Active days", value: fmt(s.activeYear), note: "In the past 365 days" },
    ];
    $("cp-tiles").innerHTML = tiles.map((t) => `
      <div class="tile${t.hero ? " hero-tile" : ""}">
        <div class="tile-label">${t.label}</div>
        <div class="tile-value">${t.value}</div>
        <div class="tile-note">${t.note}</div>
      </div>`).join("");
  }

  // ---------------------------------------------------------- platform cards
  function renderPlatforms(data) {
    $("cp-platforms").innerHTML = PLATFORMS.map((p) => {
      const d = data[p.id];
      const head = `<div class="platform-name"><span class="swatch" style="background:var(${p.color})"></span>${p.name}${d ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.handle)} ↗</a>` : ""}</div>`;
      if (!d) return `<div class="platform empty">${head}<p>Add your handle to <code>config.json</code> to show stats.</p></div>`;
      const rows = [["Max rating", fmt(d.maxRating)], ["Rated contests", fmt(d.contests.length)]];
      if (p.id === "leetcode") {
        const b = d.solvedByDifficulty;
        rows.push(["Solved", fmt(d.solved)], ["Easy / Med / Hard", `${fmt(b.easy)} / ${fmt(b.medium)} / ${fmt(b.hard)}`]);
        if (d.topPercentage != null) rows.push(["Top", `${d.topPercentage}%`]);
      } else {
        rows.push(["Solved", fmt(d.solved)]);
      }
      const sub = p.id === "codeforces" ? esc(d.rank) : p.id === "leetcode" ? esc(d.badge || "Contest rating") : "Rating";
      return `<div class="platform">${head}
        <div class="platform-rating">${fmt(d.rating)}</div>
        <div class="platform-rank">${sub}</div>
        <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      </div>`;
    }).join("");
  }

  // ---------------------------------------------------------- rating chart
  let ratingPlatform = null;

  function renderRatingTabs(data, rerender) {
    const available = PLATFORMS.filter((p) => data[p.id]?.contests?.length);
    if (!ratingPlatform || !available.some((p) => p.id === ratingPlatform)) ratingPlatform = available[0]?.id || null;
    $("rating-tabs").innerHTML = PLATFORMS.map((p) => {
      const ok = available.includes(p);
      return `<button type="button" role="tab" data-id="${p.id}" aria-selected="${p.id === ratingPlatform}" ${ok ? "" : "disabled"}>
        <span class="swatch" style="background:var(${p.color})"></span>${p.name}</button>`;
    }).join("");
    $("rating-tabs").onclick = (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b || b.disabled) return;
      ratingPlatform = b.dataset.id;
      rerender();
    };
  }

  function renderRatingChart(data) {
    const el = $("rating-chart");
    const p = PLATFORMS.find((x) => x.id === ratingPlatform);
    const contests = p ? data[p.id].contests : [];
    if (!contests.length) {
      el.innerHTML = `<div class="empty-chart">No rated contests yet — add your handles in config.json.</div>`;
      $("rating-table").innerHTML = "";
      return;
    }
    const W = el.clientWidth || 600;
    const H = W < 500 ? 220 : 280;
    const m = { l: 44, r: 52, t: 20, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const color = cssVar(p.color);
    const surface = cssVar("--surface");

    const ratings = contests.map((c) => c.rating);
    const { lo, hi, ticks } = niceTicks(Math.min(...ratings), Math.max(...ratings), H < 250 ? 4 : 5);
    const t0 = contests[0].t, t1 = contests.at(-1).t;
    const tSpan = Math.max(t1 - t0, 86400);
    const x = (t) => m.l + (contests.length === 1 ? iw / 2 : ((t - t0) / tSpan) * iw);
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

    // x ticks: years, or months for short histories
    const xt = [];
    const y0 = new Date(t0 * 1000).getUTCFullYear(), y1 = new Date(t1 * 1000).getUTCFullYear();
    if (y1 - y0 >= 2) {
      const every = Math.ceil((y1 - y0 + 1) / Math.max(2, Math.floor(iw / 70)));
      for (let yr = y0 + 1; yr <= y1; yr += every) xt.push({ t: Date.UTC(yr, 0, 1) / 1000, label: String(yr) });
    } else {
      const start = new Date(t0 * 1000);
      const months = Math.round(tSpan / (30.4 * 86400));
      const every = Math.max(1, Math.ceil(months / Math.max(2, Math.floor(iw / 70))));
      for (let i = 1; i <= months + 1; i += every) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
        const t = d.getTime() / 1000;
        if (t <= t1) xt.push({ t, label: `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? " " + d.getUTCFullYear() : ""}` });
      }
    }

    const path = contests.map((c, i) => `${i ? "L" : "M"}${x(c.t).toFixed(1)},${y(c.rating).toFixed(1)}`).join("");
    const peakI = ratings.indexOf(Math.max(...ratings));
    const last = contests.at(-1);
    const showDots = contests.length <= 40;

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(p.name)} rating over ${contests.length} contests, currently ${last.rating}, peak ${ratings[peakI]}">
        ${ticks.map((v) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
          <text class="axis-text" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("")}
        ${xt.map((d) => `<text class="axis-text" x="${x(d.t)}" y="${H - 8}" text-anchor="middle">${d.label}</text>`).join("")}
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${showDots ? contests.map((c) => `<circle cx="${x(c.t)}" cy="${y(c.rating)}" r="3.5" fill="${color}" stroke="${surface}" stroke-width="1.5"/>`).join("") : ""}
        ${peakI !== contests.length - 1 ? `
          <circle cx="${x(contests[peakI].t)}" cy="${y(ratings[peakI])}" r="4" fill="${color}" stroke="${surface}" stroke-width="2"/>
          <text class="label-text" x="${x(contests[peakI].t)}" y="${y(ratings[peakI]) - 10}" text-anchor="middle">Peak ${fmt(ratings[peakI])}</text>` : ""}
        <circle cx="${x(last.t)}" cy="${y(last.rating)}" r="4.5" fill="${color}" stroke="${surface}" stroke-width="2"/>
        <text class="label-text" x="${x(last.t) + 10}" y="${y(last.rating) + 4}">${fmt(last.rating)}</text>
        <g class="hover" visibility="hidden">
          <line class="crosshair" y1="${m.t}" y2="${m.t + ih}"/>
          <circle r="5" fill="${color}" stroke="${surface}" stroke-width="2"/>
        </g>
        <rect class="hit" x="${m.l - 8}" y="0" width="${iw + 16}" height="${H}" fill="transparent"/>
      </svg>`;

    const svg = el.querySelector("svg");
    const hover = svg.querySelector(".hover");
    const xs = contests.map((c) => x(c.t));
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      let best = 0;
      for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
      const c = contests[best];
      hover.setAttribute("visibility", "visible");
      hover.querySelector("line").setAttribute("x1", xs[best]);
      hover.querySelector("line").setAttribute("x2", xs[best]);
      hover.querySelector("circle").setAttribute("cx", xs[best]);
      hover.querySelector("circle").setAttribute("cy", y(c.rating));
      const delta = c.delta > 0 ? `+${c.delta}` : String(c.delta);
      showTip(`<div class="tt-title">${esc(c.name)}</div>
        <div class="tt-sub">${prettyTime(c.t)}</div>
        <div class="tt-row"><span class="swatch" style="background:${color}"></span><span>Rating</span><span>${fmt(c.rating)} (${delta})</span></div>
        ${c.place ? `<div class="tt-row"><span>Rank</span><span>${fmt(c.place)}</span></div>` : ""}
        ${c.performance ? `<div class="tt-row"><span>Performance</span><span>${fmt(c.performance)}</span></div>` : ""}`,
        ev.clientX, ev.clientY);
    };
    const hit = svg.querySelector(".hit");
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { hover.setAttribute("visibility", "hidden"); hideTip(); });

    // table view (newest first)
    $("rating-table").innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Contest</th><th class="num">Rank</th><th class="num">Δ</th><th class="num">Rating</th></tr></thead>
      <tbody>${contests.slice().reverse().map((c) => `<tr><td>${prettyTime(c.t)}</td>
        <td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</td>
        <td class="num">${fmt(c.place)}</td><td class="num">${c.delta > 0 ? "+" : ""}${c.delta}</td><td class="num">${fmt(c.rating)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  // ---------------------------------------------------------- heatmap
  const heat = { platform: "all", range: "past" };
  const LEVELS = [0, 1, 3, 6, 10]; // lower bound of each level
  const levelOf = (n) => (n <= 0 ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 10 ? 3 : 4);

  function rangeBounds(today) {
    if (heat.range === "past") return [addDays(today, -364), today];
    return [`${heat.range}-01-01`, `${heat.range}-12-31`];
  }

  function renderHeatmapControls(data, days, rerender) {
    const available = PLATFORMS.filter((p) => data[p.id]);
    $("heatmap-platforms").innerHTML = [`<button type="button" data-id="all" aria-pressed="${heat.platform === "all"}">All</button>`]
      .concat(PLATFORMS.map((p) => `<button type="button" data-id="${p.id}" aria-pressed="${heat.platform === p.id}" ${available.includes(p) ? "" : "disabled"}>
        <span class="swatch" style="background:var(${p.color})"></span>${p.name}</button>`)).join("");
    $("heatmap-platforms").onclick = (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b || b.disabled) return;
      heat.platform = b.dataset.id;
      rerender();
    };
    const years = [...new Set(Object.keys(days).map((d) => d.slice(0, 4)))].sort().reverse();
    const sel = $("heatmap-range");
    sel.innerHTML = `<option value="past">Past 12 months</option>` + years.map((y) => `<option value="${y}">${y}</option>`).join("");
    sel.value = heat.range;
    sel.onchange = () => { heat.range = sel.value; rerender(); };
  }

  function renderHeatmap(data, days, today) {
    const [start, end] = rangeBounds(today);
    // grid starts on the Sunday on/before start
    const startDow = new Date(toUTC(start)).getUTCDay();
    const gridStart = addDays(start, -startDow);
    const weeks = Math.ceil((toUTC(end) - toUTC(gridStart)) / 86400000 / 7 + 1 / 7);
    const left = 28, top = 18, gap = 3;
    // Fill the card on wide screens; on narrow ones keep cells legible and scroll.
    const fit = Math.floor(($("heatmap").clientWidth - left) / weeks) - gap;
    const cell = Math.max(10, Math.min(16, fit || 11)), step = cell + gap;
    const W = left + weeks * step, H = top + 7 * step;

    let cells = "", months = "", total = 0, activeDays = 0;
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      for (let dow = 0; dow < 7; dow++) {
        const d = addDays(gridStart, w * 7 + dow);
        if (d < start || d > end) continue;
        const n = dayTotal(days[d], heat.platform);
        total += n; if (n > 0) activeDays++;
        const future = d > today;
        cells += `<rect x="${left + w * step}" y="${top + dow * step}" width="${cell}" height="${cell}" rx="2.5"
          fill="var(--seq-${levelOf(n)})" ${future ? 'opacity="0.35"' : ""} data-d="${d}"/>`;
        const mo = +d.slice(5, 7);
        if (dow === 0 && mo !== lastMonth && +d.slice(8, 10) <= 7) {
          months += `<text class="axis-text" x="${left + w * step}" y="11">${MONTHS[mo - 1]}</text>`;
          lastMonth = mo;
        }
      }
    }
    const dayLabels = [[1, "Mon"], [3, "Wed"], [5, "Fri"]]
      .map(([i, l]) => `<text class="axis-text" x="0" y="${top + i * step + cell - 2}">${l}</text>`).join("");

    const el = $("heatmap");
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Activity heatmap: ${activeDays} active days">${months}${dayLabels}${cells}</svg>`;
    el.scrollLeft = el.scrollWidth; // most recent weeks visible on narrow screens

    const label = heat.platform === "all" ? "activity" : PLATFORMS.find((p) => p.id === heat.platform).unit;
    const rangeText = heat.range === "past" ? "in the past 12 months" : `in ${heat.range}`;
    $("heatmap-caption").textContent = `${fmt(activeDays)} active days ${rangeText}`
      + (heat.platform === "codeforces" || heat.platform === "atcoder" ? ` · ${fmt(total)} problems solved` : "");

    $("heatmap-legend").innerHTML = `Less ${[0, 1, 2, 3, 4].map((l) => `<i style="background:var(--seq-${l})"></i>`).join("")} More`;

    const svg = el.querySelector("svg");
    svg.onpointermove = (ev) => {
      const r = ev.target.closest("rect[data-d]");
      if (!r) return hideTip();
      const d = r.dataset.d, e = days[d] || {};
      const rows = PLATFORMS.filter((p) => (heat.platform === "all" || heat.platform === p.id) && data[p.id])
        .map((p) => `<div class="tt-row"><span class="swatch" style="background:var(${p.color})"></span><span>${p.name}</span><span>${fmt(e[p.id] || 0)} ${p.unit}</span></div>`).join("");
      showTip(`<div class="tt-title">${prettyDay(d)}</div>${rows || '<div class="tt-sub">No activity</div>'}`, ev.clientX, ev.clientY);
    };
    svg.onpointerleave = hideTip;
  }

  // ---------------------------------------------------------- column chart (shared)
  function columnChart(el, items, { color, tooltip, ariaLabel, xEvery = 1 }) {
    if (!items.length) { el.innerHTML = `<div class="empty-chart">No data yet.</div>`; return; }
    const W = el.clientWidth || 600, H = 180;
    const m = { l: 36, r: 8, t: 18, b: 24 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const maxV = Math.max(1, ...items.map((d) => d.value));
    const { hi, ticks } = niceTicks(0, maxV, 4);
    const band = iw / items.length;
    const bw = Math.min(24, Math.max(2, band - 4));
    const y = (v) => m.t + ih - (v / hi) * ih;
    const every = Math.max(xEvery, Math.ceil(items.length / Math.max(1, Math.floor(iw / 44))));
    const peak = items.reduce((b, d, i) => (d.value > items[b].value ? i : b), 0);

    const bars = items.map((d, i) => {
      const cx = m.l + band * i + band / 2;
      const h = Math.max(0, (d.value / hi) * ih);
      const x0 = cx - bw / 2, yTop = m.t + ih - h, r = Math.min(4, h, bw / 2);
      // rounded data-end, square at the baseline
      const shape = h > 0 ? `<path d="M${x0},${m.t + ih}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x0 + bw - r}Q${x0 + bw},${yTop} ${x0 + bw},${yTop + r}V${m.t + ih}Z" fill="${color}"/>` : "";
      return `<g data-i="${i}">${shape}<rect x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"/></g>
        ${i % every === 0 ? `<text class="axis-text" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>` : ""}`;
    }).join("");

    const pcx = m.l + band * peak + band / 2;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(ariaLabel)}">
      ${ticks.map((v) => `<line class="${v === 0 ? "baseline" : "gridline"}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis-text" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("")}
      ${bars}
      ${items[peak].value > 0 ? `<text class="label-text" x="${pcx}" y="${y(items[peak].value) - 6}" text-anchor="middle">${fmt(items[peak].value)}</text>` : ""}
    </svg>`;
    const svg = el.querySelector("svg");
    svg.onpointermove = (ev) => {
      const g = ev.target.closest("g[data-i]");
      if (!g) return hideTip();
      showTip(tooltip(items[+g.dataset.i]), ev.clientX, ev.clientY);
    };
    svg.onpointerleave = hideTip;
  }

  function renderMonthly(days, today) {
    const [start, end] = rangeBounds(today);
    const items = [];
    let y = +start.slice(0, 4), mo = +start.slice(5, 7);
    while (`${y}-${String(mo).padStart(2, "0")}` <= end.slice(0, 7)) {
      const key = `${y}-${String(mo).padStart(2, "0")}`;
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      let active = 0;
      for (let d = 1; d <= dim; d++) {
        const day = `${key}-${String(d).padStart(2, "0")}`;
        if (day >= start && day <= end && dayTotal(days[day], heat.platform) > 0) active++;
      }
      items.push({ label: MONTHS[mo - 1], value: active, key, dim, year: y });
      if (++mo > 12) { mo = 1; y++; }
    }
    columnChart($("monthly-chart"), items, {
      color: cssVar("--accent"),
      ariaLabel: "Active days per month",
      tooltip: (d) => `<div class="tt-title">${MONTHS[+d.key.slice(5) - 1]} ${d.year}</div><div>${d.value} of ${d.dim} days active</div>`,
    });
  }

  // ---------------------------------------------------------- curriculum
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const meter = (a, b, thin) => `<div class="meter${thin ? " thin" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="${b}" aria-valuenow="${a}"><span style="width:${pct(a, b)}%"></span></div>`;
  const catRows = (cats) => cats.map((c) => `<div>
      <div class="meter-row"><span>${esc(c.name)}</span><span class="num">${c.solved} / ${c.total}</span></div>
      ${meter(c.solved, c.total, true)}</div>`).join("");

  function renderCurriculum(data) {
    const s = data.sheet;
    if (!s) {
      $("cses-progress").innerHTML = $("usaco-progress").innerHTML = `<div class="empty-chart">Spreadsheet not loaded.</div>`;
      return;
    }
    const c = s.cses;
    $("cses-progress").innerHTML = `
      <div class="meter-big">
        <div class="meter-row"><span class="num-big">${fmt(c.solved)}<span class="muted small"> / ${fmt(c.total)}</span></span><span class="num">${pct(c.solved, c.total)}%</span></div>
        ${meter(c.solved, c.total)}
      </div>
      <div class="cat-list scroll-list">${catRows(c.categories)}</div>`;

    const u = s.usacoGuide;
    $("usaco-progress").innerHTML = `
      <div class="meter-big">
        <div class="meter-row"><span class="num-big">${fmt(u.solved)}<span class="muted small"> / ${fmt(u.total)}</span></span><span class="num">${pct(u.solved, u.total)}%</span></div>
        ${meter(u.solved, u.total)}
      </div>
      ${u.tiers.map((t) => `<details class="tier">
        <summary><div class="meter-row"><b>${esc(t.name)}</b><span class="num">${t.solved} / ${t.total}</span></div>${meter(t.solved, t.total, true)}</summary>
        <div class="cat-list">${catRows(t.categories)}</div>
      </details>`).join("")}`;
  }

  // ---------------------------------------------------------- difficulty (stacked)
  // Stack order bottom->top keeps yellow and orange apart (validated for CVD).
  const DIFF_SERIES = [
    { id: "leetcode", name: "LeetCode", color: "--lc", note: "converted" },
    { id: "sheet", name: "CSES & USACO Guide", color: "--sheet", note: "sheet estimate" },
    { id: "codeforces", name: "Codeforces", color: "--cf", note: "official rating" },
    { id: "atcoder", name: "AtCoder", color: "--ac", note: "converted" },
  ];

  function renderDifficulty(data) {
    const card = $("difficulty-card");
    const dist = data.ratingDistribution;
    const el = $("difficulty-chart");
    if (!dist || !Object.keys(dist.buckets).length) { card.hidden = true; return; }
    card.hidden = false;

    const series = DIFF_SERIES.filter((s) => Object.values(dist.buckets).some((b) => b[s.id]));
    $("difficulty-legend").innerHTML = series.slice().reverse()
      .map((s) => `<span><i class="swatch" style="background:var(${s.color})"></i>${s.name}</span>`).join("");

    const keys = Object.keys(dist.buckets).map(Number);
    const items = [];
    for (let r = Math.min(...keys); r <= Math.max(...keys); r += 100) {
      const b = dist.buckets[r] || {};
      items.push({ rating: r, parts: series.map((s) => ({ s, n: b[s.id] || 0 })), total: series.reduce((a, s) => a + (b[s.id] || 0), 0) });
    }

    const W = el.clientWidth || 600, H = 220;
    const m = { l: 36, r: 8, t: 18, b: 24 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const { hi, ticks } = niceTicks(0, Math.max(1, ...items.map((d) => d.total)), 4);
    const band = iw / items.length;
    const bw = Math.min(24, Math.max(2, band - 4));
    const y = (v) => m.t + ih - (v / hi) * ih;
    const every = Math.max(2, Math.ceil(items.length / Math.max(1, Math.floor(iw / 44))));
    const peak = items.reduce((b, d, i) => (d.total > items[b].total ? i : b), 0);
    const GAP = 2;

    const cols = items.map((d, i) => {
      const cx = m.l + band * i + band / 2, x0 = cx - bw / 2;
      const visible = d.parts.filter((p) => p.n > 0);
      let acc = 0, segs = "";
      visible.forEach((p, j) => {
        const yBot = y(acc) - (j ? GAP / 2 : 0);
        acc += p.n;
        const isTop = j === visible.length - 1;
        // keep single-problem segments visible (≥2px); exact counts are in the tooltip/table
        const yTop = Math.min(y(acc) + (isTop ? 0 : GAP / 2), yBot - 2);
        const h = yBot - yTop;
        const r = isTop ? Math.min(4, h, bw / 2) : 0;
        segs += `<path d="M${x0},${yBot}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x0 + bw - r}Q${x0 + bw},${yTop} ${x0 + bw},${yTop + r}V${yBot}Z" fill="var(${p.s.color})"/>`;
      });
      return `<g data-i="${i}">${segs}<rect x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"/></g>
        ${i % every === 0 ? `<text class="axis-text" x="${cx}" y="${H - 6}" text-anchor="middle">${d.rating}</text>` : ""}`;
    }).join("");

    const total = items.reduce((a, d) => a + d.total, 0);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${fmt(total)} problems solved by estimated Codeforces rating">
      ${ticks.map((v) => `<line class="${v === 0 ? "baseline" : "gridline"}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis-text" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("")}
      ${cols}
      <text class="label-text" x="${m.l + band * peak + band / 2}" y="${y(items[peak].total) - 6}" text-anchor="middle">${fmt(items[peak].total)}</text>
    </svg>`;
    const svg = el.querySelector("svg");
    svg.onpointermove = (ev) => {
      const g = ev.target.closest("g[data-i]");
      if (!g) return hideTip();
      const d = items[+g.dataset.i];
      showTip(`<div class="tt-title">Rated ${d.rating}</div>
        ${d.parts.slice().reverse().map((p) => `<div class="tt-row"><span class="swatch" style="background:var(${p.s.color})"></span><span>${p.s.name}</span><span>${fmt(p.n)}</span></div>`).join("")}
        <div class="tt-row"><span>Total</span><span>${fmt(d.total)}</span></div>`, ev.clientX, ev.clientY);
    };
    svg.onpointerleave = hideTip;

    const un = dist.unrated || {};
    const unratedOther = Object.entries(un).filter(([k]) => k !== "leetcode").reduce((a, [, n]) => a + n, 0);
    $("difficulty-note").textContent =
      `${fmt(total)} problems. Codeforces uses official problem ratings; CSES & USACO Guide use the estimates from my tracking sheet; `
      + `AtCoder difficulties (from AtCoder Problems) are converted to the Codeforces scale.`
      + (dist.includesLeetCode
        ? ` LeetCode uses zerotrac's contest-problem ratings, converted to the Codeforces scale; ${fmt(un.leetcode || 0)} LeetCode problems that never appeared in a contest have no rating and aren't shown.`
        : ` LeetCode isn't included yet.`)
      + (unratedOther ? ` ${fmt(unratedOther)} other solved problems have no rating yet and aren't shown.` : "");

    $("difficulty-table").innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Rating</th>${series.map((s) => `<th class="num">${s.name}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${items.filter((d) => d.total).map((d) => `<tr><td>${d.rating}</td>${d.parts.map((p) => `<td class="num">${fmt(p.n)}</td>`).join("")}<td class="num">${fmt(d.total)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }

  // ---------------------------------------------------------- boot
  async function main() {
    $("year").textContent = new Date().getFullYear();
    try {
      const cfg = await (await fetch("config.json", { cache: "no-cache" })).json();
      document.querySelectorAll("[data-bind]").forEach((n) => { if (cfg[n.dataset.bind]) n.textContent = cfg[n.dataset.bind]; });
      if (cfg.name) document.title = cfg.name;
    } catch {}

    let data;
    try {
      data = await (await fetch("data/cp.json", { cache: "no-cache" })).json();
    } catch {
      $("cp-tiles").innerHTML = `<p class="placeholder">Couldn't load data/cp.json. Run <code>node scripts/fetch-cp-data.mjs</code>, then serve the folder (e.g. <code>python3 -m http.server</code>).</p>`;
      return;
    }
    const today = todayIn(data.timezone);
    const days = buildActivity(data);
    $("cp-updated").textContent = `Updated ${new Date(data.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;

    renderTiles(data, days, today);
    renderPlatforms(data);
    renderCurriculum(data);

    const drawRating = () => { renderRatingTabs(data, drawRating); renderRatingChart(data); };
    const drawHeat = () => { renderHeatmapControls(data, days, drawHeat); renderHeatmap(data, days, today); renderMonthly(days, today); };
    const drawAll = () => { drawRating(); drawHeat(); renderDifficulty(data); };
    drawAll();
    initTheme(drawAll);

    let w = window.innerWidth, timer;
    window.addEventListener("resize", () => {
      if (window.innerWidth === w) return;
      w = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(drawAll, 150);
    });
  }
  main();
})();
