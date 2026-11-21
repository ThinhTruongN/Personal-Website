// Research page: renders content/research.json and an in-page PDF reader
// (PDF.js, pages drawn lazily as you scroll; falls back to the browser viewer).
(() => {
  "use strict";
  const { esc } = window.site;

  const paper = (r, i) => `
    <article class="paper" id="${esc(r.id)}">
      <header class="paper-head reveal">
        <p class="eyebrow">${esc(r.type)}${r.year ? ` · ${esc(r.year)}` : ""}</p>
        <h2>${esc(r.title)}</h2>
        ${r.tagline ? `<p class="tagline">${esc(r.tagline)}</p>` : ""}
        <p class="byline">${esc(r.authors)}${r.affiliation ? ` · ${esc(r.affiliation)}` : ""}</p>
        <div class="btn-row">
          ${r.pdf ? `<a class="btn btn-primary" href="#${esc(r.id)}-reader">Read the paper</a>` : ""}
          ${r.pdf ? `<a class="btn btn-secondary" href="${esc(r.pdf)}" download>Download PDF</a>` : ""}
          ${(r.links || []).map((l) => `<a class="btn btn-secondary" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}
        </div>
      </header>

      ${r.stats?.length ? `<div class="big-stats">${r.stats.map((s) => `
        <div class="big-stat reveal"><div class="v">${esc(s.value)}</div><div class="l">${esc(s.label)}</div></div>`).join("")}</div>` : ""}

      <section class="panel reveal">
        <h3>Abstract</h3>
        <p class="abstract">${esc(r.abstract)}</p>
      </section>

      ${r.findings?.length ? `<section class="panel reveal"><h3>Key findings</h3>
        <ol class="findings">${r.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ol></section>` : ""}

      ${r.figures?.length ? `<section class="panel reveal"><h3>Figures</h3><div class="gallery">${r.figures.map((f) => `
        <figure><div class="figure"><img src="${esc(f.src)}" alt="${esc(f.alt || f.caption)}" loading="lazy"></div>
        <figcaption>${esc(f.caption)}</figcaption></figure>`).join("")}</div></section>` : ""}

      ${r.pdf ? `<section class="reader reveal" id="${esc(r.id)}-reader" data-pdf="${esc(r.pdf)}">
        <div class="reader-bar">
          <h3>Full paper</h3>
          <span class="pageinfo"></span>
          <a class="more" href="${esc(r.pdf)}" target="_blank" rel="noopener">Open in new tab</a>
        </div>
        <div class="reader-pages"><p class="reader-msg">Loading paper…</p></div>
      </section>` : ""}

      ${r.inspiredBy?.length ? `<section class="panel reveal"><h3>Related work</h3>
        <ul class="refs">${r.inspiredBy.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}
    </article>`;

  // ---------------------------------------------------------- PDF reader
  async function mountReader(section) {
    const url = section.dataset.pdf;
    const pagesEl = section.querySelector(".reader-pages");
    const info = section.querySelector(".pageinfo");
    const lib = window.pdfjsLib;
    if (!lib) return fallback();
    try {
      lib.GlobalWorkerOptions.workerSrc = "assets/vendor/pdfjs-3.11.174/pdf.worker.min.js";
      const doc = await lib.getDocument(url).promise;
      pagesEl.innerHTML = "";
      info.textContent = `${doc.numPages} pages`;

      // placeholders sized to the first page's aspect ratio so scrolling is stable
      const first = await doc.getPage(1);
      const vp1 = first.getViewport({ scale: 1 });
      const ratio = vp1.height / vp1.width;
      const slots = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const slot = document.createElement("div");
        slot.className = "reader-page";
        slot.style.aspectRatio = `${1} / ${ratio}`;
        slot.dataset.page = n;
        slot.setAttribute("aria-label", `Page ${n}`);
        pagesEl.appendChild(slot);
        slots.push(slot);
      }

      const rendered = new Map(); // page -> width rendered at
      async function draw(slot) {
        const n = +slot.dataset.page;
        const w = slot.clientWidth;
        if (!w || rendered.get(n) === w) return;
        rendered.set(n, w);
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const vp = page.getViewport({ scale: (w / base.width) * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        slot.replaceChildren(canvas);
        slot.style.aspectRatio = "";
      }

      const visible = new Set();
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { visible.add(e.target); draw(e.target); } else visible.delete(e.target);
        }
        const top = [...visible].sort((a, b) => a.dataset.page - b.dataset.page)[0];
        if (top) info.textContent = `Page ${top.dataset.page} of ${doc.numPages}`;
      }, { root: pagesEl, rootMargin: "400px 0px" });
      slots.forEach((s) => io.observe(s));

      let t;
      window.addEventListener("resize", () => {
        clearTimeout(t);
        t = setTimeout(() => visible.forEach((s) => draw(s)), 200);
      });
    } catch (err) {
      fallback();
    }

    function fallback() {
      pagesEl.innerHTML = `<iframe class="reader-fallback" src="${esc(url)}" title="Paper PDF"></iframe>`;
      info.textContent = "";
    }
  }

  window.site.getJSON("content/research.json").then((list) => {
    const el = document.getElementById("research-list");
    el.innerHTML = list.map(paper).join("");
    window.site.reveal(el);
    el.querySelectorAll(".reader[data-pdf]").forEach(mountReader);
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }).catch(() => {});
})();
