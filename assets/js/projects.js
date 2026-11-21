// Projects page: renders content/projects.json as alternating feature rows.
(() => {
  "use strict";
  const { esc } = window.site;

  function visual(p) {
    const v = p.visual;
    if (v?.type === "pendulum") return `<div class="feature-visual diagram">${window.site.pendulumSVG}</div>`;
    if (v?.type === "scheduler") return `<div class="feature-visual diagram">${window.site.schedulerSVG}</div>`;
    if (v?.type === "image") return `<div class="feature-visual figure"><img src="${esc(v.src)}" alt="${esc(v.alt || p.title)}" loading="lazy"></div>`;
    return "";
  }

  const row = (p) => `
    <article class="feature reveal" id="${esc(p.id)}">
      ${visual(p)}
      <div>
        ${p.status ? `<div class="status ${/progress/i.test(p.status) ? "wip" : /complete|done/i.test(p.status) ? "done" : ""}">${esc(p.status)}</div>` : ""}
        <h2>${esc(p.title)}</h2>
        ${p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""}
        <p class="body">${esc(p.summary)}</p>
        ${p.result ? `<p class="result"><b>Result.</b> ${esc(p.result)}</p>` : ""}
        ${p.highlights?.length ? `<ul class="points">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
        ${p.tags?.length ? `<ul class="tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        ${p.links?.length ? `<div class="links">${p.links.map((l) => `<a class="more" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}</div>` : ""}
      </div>
    </article>`;

  window.site.getJSON("content/projects.json").then((list) => {
    const el = document.getElementById("projects-list");
    el.innerHTML = list.map(row).join("");
    window.site.reveal(el);
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }).catch(() => {});
})();
