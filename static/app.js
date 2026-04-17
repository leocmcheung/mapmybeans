/* =================================================================
   Coffee Atlas — app logic (Flask / BigQuery / Cloud Vision backend)
   - Tabs
   - OCR via Cloud Vision API (server-side)
   - Form extraction & submission
   - Library with search + delete
   - Leaflet map: country pins clustered, farm pins on zoom/click
   - Data: loaded from BigQuery via /api/beans
================================================================= */

// -------------------- State --------------------
let beans = [];
let map = null;
let markerLayer = null;

// -------------------- Utilities --------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function toast(msg, isError = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " toast--error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2400);
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

// -------------------- Tabs --------------------
function initTabs() {
  $$(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      $$(".tab").forEach(t => t.classList.toggle("active", t === tab));
      $$(".panel").forEach(p => p.classList.toggle("active", p.id === `panel-${target}`));
      // init map lazily when its tab is shown (Leaflet needs a visible container)
      if (target === "map") {
        setTimeout(() => { initMap(); renderMap(); }, 50);
      }
      if (target === "library") renderLibrary();
    });
  });
}

// -------------------- API --------------------
async function apiFetch(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function initData() {
  try {
    beans = await apiFetch("/api/beans");
  } catch (e) {
    toast("Could not load beans: " + e.message, true);
    beans = [];
  }
}

// -------------------- OCR --------------------
function initDropzone() {
  const dz = $("#dropzone");
  const input = $("#file-input");
  const browse = $("#browse-btn");

  const openPicker = (e) => { e && e.stopPropagation(); input.click(); };

  dz.addEventListener("click", (e) => {
    if (!dz.classList.contains("has-preview")) openPicker(e);
  });
  browse.addEventListener("click", openPicker);
  input.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) handleImage(e.target.files[0]);
  });

  ["dragover", "dragenter"].forEach(ev =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach(ev =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
  );
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleImage(f);
  });
}

function handleImage(file) {
  const dz = $("#dropzone");
  const preview = $("#preview");
  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    dz.classList.add("has-preview");
    runOCR(file);
  };
  reader.readAsDataURL(file);
}

async function runOCR(file) {
  const statusEl = $("#ocr-status");
  const fill = $("#ocr-fill");
  const textEl = $("#ocr-text");
  statusEl.hidden = false;
  fill.style.width = "20%";
  textEl.textContent = "Sending to Cloud Vision API…";

  try {
    fill.style.width = "50%";
    const fd = new FormData();
    fd.append("image", file);
    const { text, error } = await apiFetch("/api/ocr", { method: "POST", body: fd });
    if (error) throw new Error(error);
    fill.style.width = "100%";
    textEl.textContent = "Done. Extracted fields are pre-filled below — edit as needed.";
    const parsed = parseLabel(text || "");
    applyParsed(parsed);
  } catch (e) {
    fill.style.width = "0%";
    textEl.textContent = "OCR failed: " + e.message + ". Fill the form manually.";
  }
}

// -------------------- Label parser --------------------
// Heuristic label parser — works best on packaging with clear labels.
function parseLabel(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const joined = lines.join(" \n ");
  const result = {};

  // Country — check against our known coffee-producing countries
  const knownCountries = Object.values(COUNTRY_COORDS).map(c => c.canonical);
  for (const c of knownCountries) {
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(joined)) { result.country = c.replace(/ \(.*\)$/, ""); break; }
  }

  // Roast date — look for patterns like "Roasted: 12/03/2026" or "Roast date 2026-03-12"
  const roastRe = /roast(?:ed)?[\s:\-]*(?:date|on)?[\s:\-]*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|[0-9]{4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{1,2})/i;
  const rm = joined.match(roastRe);
  if (rm) result.roastDate = normalizeDate(rm[1]);

  // Process
  const procRe = /\b(washed|natural|honey|anaerobic|semi[-\s]?washed|wet[-\s]?hulled|fully washed)\b/i;
  const pm = joined.match(procRe);
  if (pm) {
    const p = pm[1].toLowerCase();
    if (p.includes("washed") && !p.includes("semi")) result.process = "Washed";
    else if (p.includes("natural")) result.process = "Natural";
    else if (p.includes("honey")) result.process = "Honey";
    else if (p.includes("anaerobic")) result.process = "Anaerobic";
    else result.process = "Other";
  }

  // Altitude
  const altRe = /([\d,]{3,5}\s*[-–]\s*[\d,]{3,5}\s*(?:masl|m|metres|meters))|([\d,]{3,5}\s*(?:masl|m\.a\.s\.l|metres|meters))/i;
  const am = joined.match(altRe);
  if (am) result.altitude = (am[0] || "").trim();

  // Taste notes — look for a line starting with "notes" or "tasting notes" or "flavour"
  const notesLine = lines.find(l => /^(tasting\s+)?(notes|flavou?r|aroma|cupping)/i.test(l));
  if (notesLine) {
    result.tasteNotes = notesLine.replace(/^(tasting\s+)?(notes|flavou?r|aroma|cupping)[\s:\-]*/i, "").trim();
  }

  // Variety
  const varRe = /\b(heirloom|bourbon|typica|caturra|catuai|geisha|gesha|pacamara|sl28|sl34|pacas|mundo novo|maragogype|sidra|castillo|parainema)\b/i;
  const vm = joined.match(varRe);
  if (vm) result.variety = vm[0].replace(/\b\w/g, l => l.toUpperCase());

  // Region/farm heuristics (best-effort)
  const regionRe = /(?:region|origin)[\s:\-]+([A-Z][A-Za-z\s-]{2,40})/;
  const regm = joined.match(regionRe);
  if (regm) result.region = regm[1].trim();

  const farmRe = /(?:farm|finca|estate|washing\s+station|co-?op|cooperative)[\s:\-]+([A-Z][A-Za-z\s-]{2,50})/i;
  const fm = joined.match(farmRe);
  if (fm) result.farm = fm[1].trim();

  return result;
}

function normalizeDate(s) {
  s = s.trim();
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  return s;
}

function applyParsed(parsed) {
  const form = $("#bean-form");
  Object.entries(parsed).forEach(([k, v]) => {
    const el = form.elements[k];
    if (el && !el.value) el.value = v;
  });
}

// -------------------- Form --------------------
function initForm() {
  const form = $("#bean-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const record = { id: uid(), createdAt: new Date().toISOString() };
    for (const [k, v] of fd.entries()) record[k] = typeof v === "string" ? v.trim() : v;

    // Auto-fill coordinates from country if user hasn't provided them
    if (!record.lat && !record.lng && record.country) {
      const c = lookupCountry(record.country);
      if (c) {
        record.lat = c.lat;
        record.lng = c.lng;
        record.coordsFromCountry = true;
      }
    } else {
      record.lat = record.lat ? parseFloat(record.lat) : null;
      record.lng = record.lng ? parseFloat(record.lng) : null;
    }

    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      await apiFetch("/api/beans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      beans.unshift(record); // optimistic: prepend so it appears first in library
      toast("Saved to library");
      form.reset();
      $("#dropzone").classList.remove("has-preview");
      $("#preview").src = "";
      $("#ocr-status").hidden = true;
    } catch (err) {
      toast("Save failed: " + err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  $("#geocode-btn").addEventListener("click", () => {
    const country = form.elements.country.value;
    const c = lookupCountry(country);
    if (c) {
      form.elements.lat.value = c.lat;
      form.elements.lng.value = c.lng;
      toast(`Using centroid for ${c.canonical}`);
    } else {
      toast("Country not in lookup — enter coordinates manually", true);
    }
  });
}

// -------------------- Library --------------------
function renderLibrary() {
  const container = $("#library");
  const searchVal = ($("#lib-search").value || "").toLowerCase();
  $("#lib-count").textContent = beans.length;

  const filtered = beans.filter(b => {
    if (!searchVal) return true;
    return [b.name, b.country, b.region, b.farm, b.roaster, b.tasteNotes]
      .filter(Boolean)
      .some(s => s.toLowerCase().includes(searchVal));
  });

  if (!filtered.length) {
    container.innerHTML = `<p class="empty">${beans.length ? "No matches." : "No beans yet — log your first one on the Log a Bean tab."}</p>`;
    return;
  }

  container.innerHTML = filtered.map(b => {
    const tags = [b.process, b.variety].filter(Boolean);
    return `
      <article class="bean" data-id="${b.id}">
        <button class="bean__del" data-del="${b.id}" title="Delete">×</button>
        <div class="bean__origin">${escapeHtml(b.country || "Unknown origin")}${b.region ? " · " + escapeHtml(b.region) : ""}</div>
        <h3 class="bean__name">${escapeHtml(b.name || "Unnamed bean")}</h3>
        <div class="bean__meta">${[b.roaster, fmtDate(b.roastDate)].filter(Boolean).map(escapeHtml).join(" · ") || "—"}</div>
        ${b.tasteNotes ? `<p class="bean__notes">${escapeHtml(b.tasteNotes)}</p>` : ""}
        ${tags.length ? `<div class="bean__tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!confirm("Delete this bean from your library?")) return;
      try {
        await apiFetch(`/api/beans/${id}`, { method: "DELETE" });
        beans = beans.filter(b => b.id !== id);
        renderLibrary();
        if (map) renderMap();
        toast("Deleted");
      } catch (err) {
        toast("Delete failed: " + err.message, true);
      }
    });
  });

  container.querySelectorAll(".bean").forEach(el => {
    el.addEventListener("click", () => {
      const bean = beans.find(b => b.id === el.dataset.id);
      if (bean) showBeanDetail(bean);
    });
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// -------------------- Modal --------------------
function showBeanDetail(b) {
  const fields = [
    ["Name", b.name],
    ["Roaster", b.roaster],
    ["Roast date", fmtDate(b.roastDate)],
    ["Country", b.country],
    ["Region", b.region],
    ["Farm / Station", b.farm],
    ["Process", b.process],
    ["Variety", b.variety],
    ["Altitude", b.altitude],
    ["Taste notes", b.tasteNotes],
    ["Purchased on", fmtDate(b.purchaseDate)],
    ["Purchased at", b.purchaseLocation],
    ["Opened on", fmtDate(b.openDate)],
    ["Personal notes", b.notes],
  ].filter(([, v]) => v && v !== "—");

  $("#modal-content").innerHTML = `
    <div class="modal__content">
      <h3>${escapeHtml(b.name || "Unnamed bean")}</h3>
      <div class="bean__origin">${escapeHtml(b.country || "")}${b.region ? " · " + escapeHtml(b.region) : ""}</div>
      <dl style="margin-top:18px;">
        ${fields.map(([k, v]) => `<div class="detail-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}
      </dl>
    </div>
  `;
  $("#modal").hidden = false;
}

function initModal() {
  $("#modal").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) $("#modal").hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("#modal").hidden = true;
  });
}

// -------------------- Map --------------------
function initMap() {
  if (map) return;
  map = L.map("map", { worldCopyJump: true }).setView([10, 0], 2);

  L.tileLayer("https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 18,
    subdomains: "abcd",
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
}

function groupBeansByLocation() {
  const byCountry = new Map();
  const farms = [];

  for (const b of beans) {
    if (!b.country) continue;
    const key = b.country.trim();
    if (!byCountry.has(key)) {
      const c = lookupCountry(b.country) || { lat: b.lat, lng: b.lng, canonical: b.country };
      byCountry.set(key, { country: b.country, lat: c.lat, lng: c.lng, beans: [] });
    }
    byCountry.get(key).beans.push(b);

    // Only plot as a separate farm marker if user provided coords AND they differ from the country centroid
    if (!b.coordsFromCountry && b.lat != null && b.lng != null) {
      farms.push(b);
    }
  }
  return { countries: Array.from(byCountry.values()), farms };
}

function renderMap() {
  if (!map) return;
  markerLayer.clearLayers();

  const { countries, farms } = groupBeansByLocation();
  if (!countries.length && !farms.length) return;

  countries.forEach(c => {
    if (c.lat == null || c.lng == null) return;
    const icon = L.divIcon({
      className: "coffee-marker",
      html: `<div class="coffee-marker__inner">${c.beans.length}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const marker = L.marker([c.lat, c.lng], { icon }).addTo(markerLayer);
    marker.bindPopup(buildCountryPopup(c));
  });

  farms.forEach(b => {
    const icon = L.divIcon({
      className: "coffee-marker coffee-marker--farm",
      html: `<div class="coffee-marker__inner"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const marker = L.marker([b.lat, b.lng], { icon }).addTo(markerLayer);
    marker.bindPopup(buildFarmPopup(b));
    marker.on("click", () => marker.openPopup());
  });

  const allPoints = [
    ...countries.filter(c => c.lat != null).map(c => [c.lat, c.lng]),
    ...farms.map(b => [b.lat, b.lng]),
  ];
  if (allPoints.length) {
    map.fitBounds(L.latLngBounds(allPoints).pad(0.2), { maxZoom: 6 });
  }
}

function buildCountryPopup(c) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="pop-title">${escapeHtml(c.country)}</div>
    <div class="pop-meta">${c.beans.length} bean${c.beans.length === 1 ? "" : "s"} logged</div>
    <div style="margin-top:10px; font-size:0.85rem; max-height:180px; overflow-y:auto;">
      ${c.beans.map(b => `
        <div style="padding:6px 0; border-top:1px dotted var(--line);">
          <strong style="font-style:italic;">${escapeHtml(b.name || "Unnamed")}</strong>
          ${b.farm ? `<br><span class="pop-meta">${escapeHtml(b.farm)}</span>` : ""}
          <br><button class="pop-view" data-bean-id="${b.id}">View details →</button>
        </div>
      `).join("")}
    </div>
  `;
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bean-id]");
    if (btn) {
      const bean = beans.find(x => x.id === btn.dataset.beanId);
      if (bean) showBeanDetail(bean);
    }
  });
  return wrap;
}

function buildFarmPopup(b) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="pop-title">${escapeHtml(b.name || "Unnamed bean")}</div>
    <div class="pop-meta">${escapeHtml(b.farm || b.region || b.country || "")}</div>
    ${b.tasteNotes ? `<div style="margin-top:8px; font-size:0.9rem;">${escapeHtml(b.tasteNotes)}</div>` : ""}
    <button class="pop-view" data-bean-id="${b.id}">View full details →</button>
  `;
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bean-id]");
    if (btn) {
      const bean = beans.find(x => x.id === btn.dataset.beanId);
      if (bean) showBeanDetail(bean);
    }
  });
  return wrap;
}

// -------------------- Data panel --------------------
function initDataPanel() {
  $("#export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(beans, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "beans.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("#data-status").textContent = `Exported ${beans.length} bean(s).`;
  });

  $("#import-input").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const parsed = JSON.parse(txt);
      const arr = Array.isArray(parsed) ? parsed : parsed.beans;
      if (!Array.isArray(arr)) throw new Error("File is not a bean array.");
      let count = 0;
      for (const bean of arr) {
        await apiFetch("/api/beans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bean),
        });
        count++;
      }
      beans = await apiFetch("/api/beans");
      renderLibrary();
      if (map) renderMap();
      $("#data-status").textContent = `Imported ${count} bean(s).`;
      toast("Imported");
    } catch (err) {
      toast("Import failed: " + err.message, true);
    }
  });

  $("#reload-btn").addEventListener("click", async () => {
    try {
      beans = await apiFetch("/api/beans");
      renderLibrary();
      if (map) renderMap();
      $("#data-status").textContent = `Loaded ${beans.length} bean(s) from database.`;
      toast("Reloaded from database");
    } catch (err) {
      toast("Reload failed: " + err.message, true);
    }
  });

  $("#clear-btn").addEventListener("click", async () => {
    if (!confirm("Delete ALL beans from the cloud database? This cannot be undone.")) return;
    try {
      await apiFetch("/api/beans", { method: "DELETE" });
      beans = [];
      renderLibrary();
      if (map) renderMap();
      $("#data-status").textContent = "All data deleted from database.";
      toast("Cleared");
    } catch (err) {
      toast("Clear failed: " + err.message, true);
    }
  });
}

// -------------------- Search --------------------
function initSearch() {
  $("#lib-search").addEventListener("input", renderLibrary);
}

// -------------------- Boot --------------------
(async function boot() {
  initTabs();
  initDropzone();
  initForm();
  initSearch();
  initDataPanel();
  initModal();
  await initData();
  renderLibrary();
})();
