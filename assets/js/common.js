// Shared by every page: theme toggle, name/tagline from config.json,
// footer year, scroll-reveal, and small helpers used by page scripts.
(() => {
  "use strict";
  const site = (window.site = {});

  site.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  site.getJSON = (url) => fetch(url, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  // ---- theme: toggles html[data-theme]; pages redraw on "themechange"
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme
        || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch {}
      document.dispatchEvent(new Event("themechange"));
    });
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => document.dispatchEvent(new Event("themechange")));

  // ---- scroll reveal
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 })
    : null;
  site.reveal = (root = document) => {
    root.querySelectorAll(".reveal:not(.in)").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
  };

  // ---- config-driven text
  const yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();
  site.config = site.getJSON("config.json").then((cfg) => {
    document.querySelectorAll("[data-bind]").forEach((n) => { if (cfg[n.dataset.bind]) n.textContent = cfg[n.dataset.bind]; });
    return cfg;
  }).catch(() => ({}));

  // ---- shared illustration: three-link pendulum on a cart (theme colors)
  site.pendulumSVG = `
    <svg viewBox="0 0 320 200" role="img" aria-label="Diagram of a three-link pendulum mounted on a cart">
      <line x1="20" y1="176" x2="300" y2="176" stroke="var(--axis)" stroke-width="2" stroke-linecap="round"/>
      <rect x="128" y="150" width="64" height="22" rx="6" fill="var(--text-2)"/>
      <circle cx="142" cy="174" r="5" fill="var(--surface)" stroke="var(--text-2)" stroke-width="2"/>
      <circle cx="178" cy="174" r="5" fill="var(--surface)" stroke="var(--text-2)" stroke-width="2"/>
      <g stroke="var(--accent)" stroke-width="6" stroke-linecap="round">
        <line x1="160" y1="150" x2="176" y2="106"/><line x1="176" y1="106" x2="166" y2="60"/><line x1="166" y1="60" x2="186" y2="18"/>
      </g>
      <g fill="var(--surface)" stroke="var(--accent)" stroke-width="3">
        <circle cx="160" cy="150" r="5"/><circle cx="176" cy="106" r="5"/><circle cx="166" cy="60" r="5"/>
      </g>
      <circle cx="186" cy="18" r="7" fill="var(--accent)"/>
      <path d="M96 161 h-30 m0 0 l8 -6 m-8 6 l8 6" stroke="var(--muted)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M224 161 h30 m0 0 l-8 -6 m8 6 l-8 6" stroke="var(--muted)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  // ---- shared illustration: requests flowing from an edge server to K remote servers
  const remotes = [30, 82, 134].map((y, i) => `
      <path d="M118 100 C 160 100, 168 ${y + 18}, 210 ${y + 18}" stroke="var(--accent)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <rect x="210" y="${y}" width="92" height="36" rx="9" fill="var(--surface)" stroke="var(--axis)" stroke-width="1.5"/>
      <text x="256" y="${y + 23}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text-2)">Remote ${i + 1}</text>`).join("");
  site.schedulerSVG = `
    <svg viewBox="0 0 320 200" role="img" aria-label="Diagram of requests queued at an edge server and dispatched to three remote servers">
      ${[0, 1, 2, 3].map((i) => `<circle cx="${14 + i * 12}" cy="100" r="4.5" fill="var(--accent)" opacity="${0.35 + i * 0.2}"/>`).join("")}
      <path d="M62 100 h10" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"/>
      ${remotes}
      <rect x="74" y="76" width="44" height="48" rx="10" fill="var(--accent)"/>
      <text x="96" y="104" text-anchor="middle" font-size="12" font-weight="700" fill="var(--accent-text)">Edge</text>
    </svg>`;

  document.addEventListener("DOMContentLoaded", () => site.reveal());
  if (document.readyState !== "loading") site.reveal();
})();
