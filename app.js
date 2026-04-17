/* =================================================================
   Coffee Atlas — app logic
   - Tabs
   - OCR via Tesseract.js
   - Form extraction & submission
   - Library with search + delete
   - Leaflet map: country pins clustered, farm pins on zoom/click
   - Data: loaded from beans.json in repo, stored in localStorage,
           exported back as beans.json
================================================================= */

// -------------------- Constants --------------------
const STORAGE_KEY = "coffeeAtlas.beans.v1";
const REPO_JSON_PATH = "beans.json"; // relative, sits next to index.html

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

// -------------------- Storage --------------------
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(beans));
  } catch (e) {
    toast("Could not save locally: " + e.message, true);
  }
}

async function loadFromRepo() {
  try {
    const res = await fetch(REPO_JSON_PATH, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.beans)) return data.beans;
    return [];
  } catch (e) {
    return null; // fine on first run — file may not exist yet
  }
}

async function initData() {
  // Priority: local (latest user edits) > repo file > empty
  const local = loadLocal();
  if (local && local.length) {
    beans = local;
    return;
  }
  const repo = await loadFromRepo();
  if (repo) {
    beans = repo;
    saveLocal();
    return;
  }
  beans = [];
}

// -------------------- OCR --------------------
let ocrWorker = null;

function initDropzone() {
  const dz = $("#dropzone");
  const input = $("#file-input");
  const browse = $("#browse-btn");
  const preview = $("#preview");

  const openPicker = (e) => {
    e && e.stopPropagation();
    input.click();
  };

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
    runOCR(e.target.result);
  };
  reader.readAsDataURL(file);
}

async function runOCR(dataUrl) {
  const statusEl = $("#ocr-status");
  const fill = $("#ocr-fill");
  const textEl = $("#ocr-text");
  statusEl.hidden = false;
  fill.style.width = "5%";
  textEl.textContent = "Loading text recognition engine…";

  try {
    if (!ocrWorker) {
      ocrWorker = await Tesseract.createWorker("eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            fill.style.width = Math.round(m.progress * 100) + "%";
            textEl.textContent = `Reading label… ${Math.round(m.progress * 100)}%`;
          }
        }
      });
    }
    textEl.textContent = "Reading label…";
    const { data } = await ocrWorker.recognize(dataUrl);
    fill.style.width = "100%";
    textEl.textContent = "Done. Extracted fields are pre-filled below — edit as needed.";

    const parsed = parseLabel(data.text || "");
    applyParsed(parsed, data.text || "");
  } catch (e) {
    textEl.textContent = "OCR failed: " + e.message + ". Fill the form manually.";
  }
}

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

  // Name fallback — longest line in Title Case, if nothing else looks like a name
  // (leave name empty so the user fills it; we don't want a wrong guess)

  return result;
}

function normalizeDate(s) {
  // Try various formats, return ISO yyyy-mm-dd or original on failure
  s = s.trim();
  // yyyy-mm-dd or yyyy/mm/dd
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  // dd/mm/yyyy or mm/dd/yyyy — assume dd/mm/yyyy (EU common)
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  return s;
}

function applyParsed(parsed, rawText) {
  const form = $("#bean-form");
  Object.entries(parsed).forEach(([k, v]) => {
    const el = form.elements[k];
    if (el && !el.value) el.value = v;
  });
}

// -------------------- Form --------------------
function initForm() {
  const form = $("#bean-form");
  form.addEventListener("submit", (e) => {
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

    beans.push(record);
    saveLocal();
    toast("Saved to library");
    form.reset();
    $("#dropzone").classList.remove("has-preview");
    $("#preview").src = "";
    $("#ocr-status").hidden = true;
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
    const notes = [b.tasteNotes, b.process].filter(Boolean);
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
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!confirm("Delete this bean from your library?")) return;
      beans = beans.filter(b => b.id !== id);
      saveLocal();
      renderLibrary();
      if (map) renderMap();
      toast("Deleted");
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

  // Stadia-free tile option: use Carto's voyager for a warm cartographic feel
  L.tileLayer("https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 18,
    subdomains: "abcd",
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
}

function groupBeansByLocation() {
  // country groups keyed by canonical country name
  const byCountry = new Map();
  // farm groups — only when a bean has its own specific lat/lng (not the country centroid)
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

  if (!countries.length && !farms.length) {
    return;
  }

  // Country markers
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

  // Farm markers
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

  // Fit map
  const allPoints = [
    ...countries.filter(c => c.lat != null).map(c => [c.lat, c.lng]),
    ...farms.map(b => [b.lat, b.lng]),
  ];
  if (allPoints.length) {
    const bounds = L.latLngBounds(allPoints);
    map.fitBounds(bounds.pad(0.2), { maxZoom: 6 });
  }
}

function buildCountryPopup(c) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="pop-title">${escapeHtml(c.country)}</div>
    <div class="pop-meta">${c.beans.length} bean${c.beans.length === 1 ? "" : "s"} logged</div>
    <span class="pop-count">${c.beans.length}</span>
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
  // delegate click on the popup
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
    $("#data-status").textContent = `Exported ${beans.length} bean(s) — commit beans.json to your repo to sync.`;
  });

  $("#import-input").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const parsed = JSON.parse(txt);
      const arr = Array.isArray(parsed) ? parsed : parsed.beans;
      if (!Array.isArray(arr)) throw new Error("File is not a bean array.");
      beans = arr;
      saveLocal();
      renderLibrary();
      if (map) renderMap();
      $("#data-status").textContent = `Imported ${beans.length} bean(s).`;
      toast("Imported");
    } catch (err) {
      toast("Import failed: " + err.message, true);
    }
  });

  $("#reload-btn").addEventListener("click", async () => {
    const repo = await loadFromRepo();
    if (repo === null) { toast("No beans.json found in repo", true); return; }
    beans = repo;
    saveLocal();
    renderLibrary();
    if (map) renderMap();
    $("#data-status").textContent = `Loaded ${beans.length} bean(s) from repo.`;
    toast("Reloaded from repo");
  });

  $("#clear-btn").addEventListener("click", () => {
    if (!confirm("Clear all local data? Exported beans.json is unaffected.")) return;
    beans = [];
    localStorage.removeItem(STORAGE_KEY);
    renderLibrary();
    if (map) renderMap();
    $("#data-status").textContent = "Local data cleared.";
    toast("Cleared");
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
