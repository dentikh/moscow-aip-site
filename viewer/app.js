/* АИП-монитор: слои Яндекс/OSM, фильтры тип×зона, попапы, постоянная легенда. */
"use strict";

const KIND_COLORS = {
  road: "#d94f00", bridge: "#b30059", zhk: "#7c4dff", renovation: "#9c27b0",
  kot: "#5e35b1", school: "#1e88e5", kindergarten: "#039be5", clinic: "#e53935",
  park: "#43a047", embankment: "#00897b", bike: "#7cb342", metro: "#6d4c41",
  other: "#607d8b",
};
const KIND_LABELS = {
  road: "Дороги/УДС", bridge: "Мосты/путепроводы", zhk: "ЖК", renovation: "Реновация",
  kot: "КОТ", school: "Школы", kindergarten: "Детсады", clinic: "Поликлиники",
  park: "Парки", embankment: "Набережные", bike: "Велодорожки", metro: "Метро/МЦД",
  other: "Другое",
};
const STATUS_LABELS = { designed: "проект", construction: "стройка", operation: "эксплуатация" };
const ROMAN_QUARTERS = { 1: "I", 2: "II", 3: "III", 4: "IV" };

function deadlineLabel(planYears) {
  const end = planYears && planYears.end;
  if (!end) return "";
  const q = planYears.end_quarter && ROMAN_QUARTERS[planYears.end_quarter];
  return q ? `до ${q} кв. ${end}` : `до ${end}`;
}
const ZONE_LABELS = {
  tushino: "Тушино / Покровское-Стрешнево",
  aminevskoe: "Аминьевское / Очаково (~5 км)",
  citywide: "Общегородские магистрали",
};
const OKRUG_ORDER = [
  "ЦАО", "САО", "СВАО", "ВАО", "ЮВАО", "ЮАО",
  "ЮЗАО", "ЗАО", "СЗАО", "ЗелАО", "НАО", "ТАО",
];

const yandexTiles = L.tileLayer(
  "https://core-stv-renderer.maps.yandex.net/2.x/tiles?l=map&x={x}&y={y}&z={z}" +
  "&projection=web_mercator&scale=1&v=2026.09",
  { maxZoom: 19, attribution: "© Яндекс" });
const osmTiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  { maxZoom: 19, attribution: "© OpenStreetMap contributors" });

const map = L.map("map", { layers: [yandexTiles] });
L.control.layers({ "Яндекс": yandexTiles, "OSM": osmTiles }).addTo(map);

let tileErrors = 0;
let fallbackDone = false;
yandexTiles.on("tileerror", () => {
  if (fallbackDone || ++tileErrors <= 10) return;
  fallbackDone = true;
  map.removeLayer(yandexTiles);
  map.addLayer(osmTiles);
  toast("Тайлы Яндекса недоступны — включён OSM");
});

function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 6000);
}

const fc = (typeof OBJECTS !== "undefined") ? OBJECTS
  : { type: "FeatureCollection", features: [] };

const state = {
  kinds: new Set(),
  districts: new Set(),
  allDistrictsSelected: true,
  statuses: new Set(),
  year: "all",
  query: "",
  hideIssues: false,
};
const CITY_PREFIX = "city:";  // фоновые объекты «вся Москва» (низкий приоритет)

function isCityZone(f) {
  return String(f.properties.zone || "").startsWith(CITY_PREFIX);
}

function featureDistricts(f) {
  const p = (f && f.properties) || {};
  if (Array.isArray(p.districts) && p.districts.length) return p.districts;
  const z = String(p.zone || "");
  if (z.startsWith(CITY_PREFIX)) {
    return z.slice(CITY_PREFIX.length).split(" + ").map(s => s.trim()).filter(Boolean);
  }
  return z ? [ZONE_LABELS[z] || z] : [];
}

function featureLocationLabel(props) {
  const ds = Array.isArray(props.districts) && props.districts.length
    ? props.districts
    : [ZONE_LABELS[props.zone] || String(props.zone || "").replace(/^city:/, "")].filter(Boolean);
  const oks = Array.isArray(props.okrugs) && props.okrugs.length
    ? ` (${props.okrugs.join(", ")})`
    : "";
  return ds.join(", ") + oks;
}
const kindLayers = {};

function statusColor(kind, status) {
  if (status === "operation") return mix(KIND_COLORS[kind] || KIND_COLORS.other, "#8bc34a", 0.45);
  return KIND_COLORS[kind] || KIND_COLORS.other;
}

/* ---------- Формы маркеров по стадии (точечные объекты) ---------- */
const STATUS_SHAPES = {
  designed: "M8 1.5 L15 14.5 L1 14.5 Z",           // треугольник
  construction: "M2.5 2.5 h11 v11 h-11 Z",          // квадрат
  operation: "M8 1.5 a6.5 6.5 0 1 0 0.001 0 Z",     // круг
};
const STATUS_SHAPE_LABELS = { designed: "треугольник", construction: "квадрат", operation: "круг" };

function shapeSvg(status, color, size = 16) {
  const d = STATUS_SHAPES[status] || STATUS_SHAPES.other || STATUS_SHAPES.designed;
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16">` +
    `<path d="${d}" fill="${color}" stroke="#333" stroke-width="1"/></svg>`;
}

function statusIcon(feature, city) {
  const p = feature.properties || {};
  const color = statusColor(p.kind, p.status);
  const size = city ? 10 : 16;
  return L.divIcon({
    html: shapeSvg(p.status, color, size),
    className: city ? "status-marker city-marker" : "status-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function mix(hexA, hexB, k) {
  const pa = [1, 3, 5].map(i => parseInt(hexA.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(hexB.slice(i, i + 2), 16));
  const pc = pa.map((a, i) => Math.round(a * (1 - k) + pb[i] * k));
  return "#" + pc.map(c => c.toString(16).padStart(2, "0")).join("");
}

/* Ссылка на выпуск Вестника по имени тома наблюдений (vestnik-722-2025.pdf
   → код 722 уже «схлопнут», 72/2); диффы и прочие файлы — не выпуск. */
function pressaUrlFromVolume(filename) {
  const m = /^vestnik-(\d+)-(\d{4})\.pdf$/.exec(String(filename || ""));
  return m ? `https://pressa.ru/ru/magazines/vestnik-moskvyi/${m[1]}-${m[2]}`
    : null;
}

/* Ручные досье (dossier/manual/) по объектам карты: object id -> slug
   (только те, чьи файлы реально есть); остальные manual:* и авто-объекты —
   dossier/<id с «:»→«-»>.md — их пишет build_dossier (проверено ревью 2026-11-05:
   dossier/manual/ существует лишь у двух slug — иначе 404 «Досье»). */
const MANUAL_DOSSIERS = {
  "stroi:construction-4669": "pohodny-proezd-skhodnensky-tupik",
  "manual:mcc-magistral-svh-lenshosse": "mcc-magistral-svh-lenshosse",
};

function dossierUrl(props) {
  const slug = MANUAL_DOSSIERS[props.id];
  if (slug) return `../dossier/manual/${slug}.md`;
  if (props.id && props.id.includes(":")) {
    return `../dossier/${props.id.replace(":", "-")}.md`;
  }
  return "../dossier/index.md";
}

function popupHtml(f) {
  const props = f.properties;
  const year = deadlineLabel(props.plan_years);
  const sources = (props.sources || []).map(s => {
    const url = escapeHtml(s.url || "");
    const label = escapeHtml(s.source || "источник");
    const date = escapeHtml(s.date || "");
    return `<div class="popup-row">источник: ${url ? `<a href="${url}" target="_blank" rel="noopener">${label}</a>` : label}${date ? ` (${date})` : ""}</div>`;
  }).join("");
  const obs = (props.observations || []).slice(-5).reverse().map(o => {
    const link = pressaUrlFromVolume(o.source_url);
    const src = link ? ` <a href="${link}" target="_blank" rel="noopener">выпуск</a>` : "";
    return `<li>${escapeHtml(o.date)}: ${escapeHtml(o.note)}${src}</li>`;
  }).join("");
  const vest = (props.vestnik || []).map(v => {
    const pages = v.pages ? `, стр. ${escapeHtml(v.pages)}` : "";
    const label = v.pp ? `Постановление ${escapeHtml(v.pp)}` : "Документ";
    const head = v.url
      ? `<a href="${escapeHtml(v.url)}" target="_blank" rel="noopener">${label}</a>`
      : label;
    const t = v.title || "";
    return `<div class="popup-row">📰 ${head} от ${escapeHtml(v.date || "")}${pages}: ${escapeHtml(t.slice(0, 90))}${t.length > 90 ? "…" : ""}</div>`;
  }).join("");
  return `<div class="popup-title">${escapeHtml(props.name)}</div>` +
    `<div class="popup-row">статус: ${escapeHtml(STATUS_LABELS[props.status] || props.status)}` +
    `${year ? ` · срок: ${escapeHtml(year)}` : ""}</div>` +
    `<div class="popup-row">район: ${escapeHtml(featureLocationLabel(props))} · тип: ${escapeHtml(KIND_LABELS[props.kind] || props.kind)}</div>` +
    geometryRow(f) +
    issuesBlock(props) +
    (vest || "") +
    (sources || "") +
    (obs ? `<ul class="popup-obs">${obs}</ul>` : "") +
    `<div class="popup-dossier"><a href="${escapeHtml(dossierUrl(props))}" target="_blank" rel="noopener">📄 Досье</a></div>`;
}

/* Ревизия «просто линий» (2026-11-06): честная пометка, что линейная
   геометрия — ось трассы из источника, а не точная проезжая часть. */
function geometryRow(f) {
  const role = f.properties.geometry_role;
  if (role === "axis") {
    return `<div class="popup-row">геометрия: ось трассы (источник даёт только ось)</div>`;
  }
  if (role === "hull") {
    return `<div class="popup-row">геометрия: габарит по вершинам источника</div>`;
  }
  return "";
}

/* Пометки проблем геометрии (замечание 2026-11-06: «помечать и
   классифицировать: смещение, неверный тип, неверная отрисовка»). */
const ISSUE_LABELS = {
  axis: "источник даёт только ось трассы",
  hull: "габарит — выпуклая оболочка вершин источника",
  "type-mismatch": "тип геометрии не соответствует описанию",
  "offset-suspect": "подозрение на смещение (замер против зданий OSM)",
};

function issuesBlock(props) {
  const issues = props.geo_issues || [];
  if (!issues.length) return "";
  const items = issues.map(i =>
    `<li>${ISSUE_LABELS[i.code] || escapeHtml(i.code)}${i.note ? ` — ${escapeHtml(i.note)}` : ""}</li>`).join("");
  return `<div class="popup-issues">⚠️ Геометрия условная:<ul>${items}</ul></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function styleFor(feature) {
  const kind = feature.properties.kind;
  const color = statusColor(kind, feature.properties.status);
  const geom = feature.geometry || { type: "Point" };
  if (geom.type === "Point") {
    return { radius: 6, color: "#333", weight: 1, fillColor: color, fillOpacity: 0.9 };
  }
  if (geom.type === "LineString" || geom.type === "MultiLineString") {
    // Ревизия «просто линий» (2026-11-06; правка по замечанию «дороги
    // пострадали»): ось трассы рисуем СТРОКОЙ умеренной толщины —
    // «лента» weight 10 вводила в заблуждение шириной
    const ribbon = kind === "road" || kind === "bridge";
    return { color, weight: ribbon ? 5 : 3, opacity: 0.85,
             lineCap: "round", lineJoin: "round" };
  }
  return { color, weight: 4, opacity: 0.85, fillOpacity: 0.25 };
}

const geojsonLayer = L.geoJSON(fc, {
  style: styleFor,
  // форма точки = стадия у ВСЕХ объектов, включая фон «вся Москва»
  // (раньше фон рисовался кружками и стадии на карте не читались)
  pointToLayer: (f, latlng) =>
    L.marker(latlng, { icon: statusIcon(f, isCityZone(f)) }),
  onEachFeature: (f, layer) => layer.bindPopup(() => popupHtml(f)),
}).addTo(map);

for (const f of fc.features) {
  const kind = f.properties.kind;
  if (!kindLayers[kind]) kindLayers[kind] = [];
  kindLayers[kind].push(f);
}

function matchesQuery(p) {
  const q = state.query.trim().toLowerCase();
  return !q || String(p.name || "").toLowerCase().includes(q);
}

function matchesZone(f) {
  if (state.allDistrictsSelected) return true;
  if (state.districts.size === 0) return false;
  return featureDistricts(f).some(d => state.districts.has(d));
}

function matchesFilter(f) {
  const p = f.properties;
  const year = p.plan_years && p.plan_years.end;
  return state.kinds.has(p.kind) && matchesZone(f) && matchesQuery(p) &&
    state.statuses.has(p.status) &&
    (state.year === "all" || (year != null && String(year) === state.year)) &&
    (!state.hideIssues || !(p.geo_issues || []).length);
}

function rebuild() {
  geojsonLayer.clearLayers();
  const chosen = fc.features.filter(matchesFilter);
  updateSearchInfo(chosen);
  // низкий приоритет: фоновые city:* добавляются ПЕРВЫМИ (рисуются ниже)
  const ordered = [...chosen.filter(isCityZone), ...chosen.filter(f => !isCityZone(f))];
  geojsonLayer.addData({ type: "FeatureCollection", features: ordered });
}

/* ---------- Поиск по ключевым словам (название объекта) ---------- */
function updateSearchInfo(chosen) {
  const info = document.getElementById("search-info");
  if (!info) return;
  const q = state.query.trim();
  if (!q) { info.classList.add("hidden"); return; }
  info.textContent = `найдено: ${chosen.length}`;
  info.classList.remove("hidden");
}

function zoomToMatches() {
  const q = state.query.trim().toLowerCase();
  if (!q) return;
  const chosen = fc.features.filter(matchesFilter);
  const pts = [];
  for (const f of chosen) {
    const g = f.geometry;
    if (!g) continue;
    const flat = [];
    (function walk(c) { Array.isArray(c[0]) ? c.forEach(walk) : flat.push(c); })(g.coordinates);
    for (const [lon, lat] of flat) {
      if (lat > 54 && lat < 57 && lon > 35 && lon < 40) pts.push([lat, lon]);
    }
  }
  if (!pts.length) { toast("Ничего не найдено"); return; }
  map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16 });
}

function initSearch() {
  const input = document.getElementById("search");
  const btn = document.getElementById("search-go");
  if (!input) return;
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = input.value; rebuild(); }, 250);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); zoomToMatches(); }
  });
  if (btn) btn.addEventListener("click", zoomToMatches);
}

function initPanel() {
  // счётчики типов — по приоритетным объектам; фон city:* не раздувает
  // панель, НО чекбоксы создаются по ВСЕМ kind'ам из данных: детсады
  // существуют только в фоне — раньше чекбокс не создавался, тип не
  // попадал в state.kinds и такие объекты были невидимы навсегда.
  const counts = {};
  const cityCounts = {};
  for (const f of fc.features) {
    const k = f.properties.kind;
    if (isCityZone(f)) {
      cityCounts[k] = (cityCounts[k] || 0) + 1;
      continue;
    }
    counts[k] = (counts[k] || 0) + 1;
  }
  const kindsBox = document.getElementById("kinds");
  const kinds = Object.keys(kindLayers)
    .sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  for (const kind of kinds) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => {
      cb.checked ? state.kinds.add(kind) : state.kinds.delete(kind);
      rebuild();
    });
    label.appendChild(cb);
    const n = counts[kind] || 0;
    const cn = cityCounts[kind] || 0;
    label.appendChild(document.createTextNode(
      ` ${KIND_LABELS[kind] || kind} (${n || cn}${n === 0 && cn ? " фон" : ""})`));
    kindsBox.appendChild(label);
    state.kinds.add(kind);
  }
  initZoneTree();
  const totalDistricts = new Set(fc.features.flatMap(featureDistricts)).size;
  document.getElementById("stats").textContent =
    `объектов: ${fc.features.length} · районов: ${totalDistricts}`;
}

function initZoneTree() {
  const body = document.getElementById("zone-tree-body");
  const summaryEl = document.getElementById("zone-summary");
  const filterInput = document.getElementById("zone-filter");
  if (!body) return;

  const districtCounts = {};
  const okrugByDistrict = {};
  // Шаг 1: из объектов с одним округом точно узнаём округ каждого района
  for (const f of fc.features) {
    const ds = featureDistricts(f);
    const oks = (f.properties && f.properties.okrugs) || [];
    for (const d of ds) {
      districtCounts[d] = (districtCounts[d] || 0) + 1;
      if (oks.length === 1 && !okrugByDistrict[d]) {
        okrugByDistrict[d] = oks[0];
      }
    }
  }
  // Шаг 2: фолбэк для районов, встретившихся только в мульти-окружных объектах
  for (const f of fc.features) {
    const ds = featureDistricts(f);
    const oks = (f.properties && f.properties.okrugs) || [];
    for (const d of ds) {
      if (!okrugByDistrict[d]) {
        okrugByDistrict[d] = oks[0] || "Другие";
      }
    }
  }

  const allDistricts = Object.keys(districtCounts).sort((a, b) => a.localeCompare(b, "ru"));
  for (const d of allDistricts) state.districts.add(d);
  state.allDistrictsSelected = true;

  const districtsByOkrug = {};
  for (const d of allDistricts) {
    const ok = okrugByDistrict[d] || "Другие";
    if (!districtsByOkrug[ok]) districtsByOkrug[ok] = [];
    districtsByOkrug[ok].push(d);
  }
  const okrugs = [
    ...OKRUG_ORDER.filter(ok => districtsByOkrug[ok]),
    ...Object.keys(districtsByOkrug).filter(ok => !OKRUG_ORDER.includes(ok)),
  ];

  // Считаем уникальные объекты на округ (объект в 2 районах одного округа считается 1 раз)
  const okrugObjCounts = {};
  for (const ok of okrugs) okrugObjCounts[ok] = 0;
  for (const f of fc.features) {
    const fOks = new Set(featureDistricts(f).map(d => okrugByDistrict[d] || "Другие"));
    for (const ok of fOks) {
      okrugObjCounts[ok] = (okrugObjCounts[ok] || 0) + 1;
    }
  }

  // Уровень 1: Вся Москва
  const lvl1 = document.createElement("label");
  lvl1.className = "zone-lvl1";
  const allCb = document.createElement("input");
  allCb.type = "checkbox";
  allCb.checked = true;
  lvl1.appendChild(allCb);
  const allTitle = document.createElement("b");
  allTitle.textContent = "Вся Москва";
  lvl1.appendChild(allTitle);
  const allCnt = document.createElement("span");
  allCnt.className = "zone-cnt";
  allCnt.textContent = `(${fc.features.length})`;
  lvl1.appendChild(allCnt);
  body.appendChild(lvl1);

  const okrugNodes = [];
  const districtCbs = new Map();

  // Уровень 2: Административные округа -> Уровень 3: Районы города
  for (const ok of okrugs) {
    const ds = districtsByOkrug[ok];
    const det = document.createElement("details");
    det.className = "zone-okrug";
    const sum = document.createElement("summary");
    const head = document.createElement("span");
    head.className = "zone-okrug-head";
    const okCb = document.createElement("input");
    okCb.type = "checkbox";
    okCb.checked = true;
    okCb.addEventListener("click", e => e.stopPropagation());
    head.appendChild(okCb);
    const okTitle = document.createElement("b");
    okTitle.textContent = ok;
    head.appendChild(okTitle);
    const okCnt = document.createElement("span");
    okCnt.className = "zone-cnt";
    okCnt.textContent = `(${okrugObjCounts[ok] || 0})`;
    head.appendChild(okCnt);
    sum.appendChild(head);
    det.appendChild(sum);

    const list = document.createElement("div");
    list.className = "zone-districts";
    const rows = [];
    for (const d of ds) {
      const lbl = document.createElement("label");
      lbl.className = "zone-lvl3";
      const dCb = document.createElement("input");
      dCb.type = "checkbox";
      dCb.checked = true;
      dCb.addEventListener("change", () => {
        dCb.checked ? state.districts.add(d) : state.districts.delete(d);
        syncUI();
        rebuild();
      });
      lbl.appendChild(dCb);
      lbl.appendChild(document.createTextNode(d + " "));
      const dCnt = document.createElement("span");
      dCnt.className = "zone-cnt";
      dCnt.textContent = `(${districtCounts[d] || 0})`;
      lbl.appendChild(dCnt);
      list.appendChild(lbl);
      districtCbs.set(d, dCb);
      rows.push({ name: d, el: lbl });
    }
    det.appendChild(list);
    body.appendChild(det);

    okCb.addEventListener("change", () => {
      for (const d of ds) {
        okCb.checked ? state.districts.add(d) : state.districts.delete(d);
      }
      syncUI();
      rebuild();
    });
    okrugNodes.push({ ok, ds, det, okCb, rows });
  }

  allCb.addEventListener("change", () => {
    if (allCb.checked) {
      for (const d of allDistricts) state.districts.add(d);
    } else {
      state.districts.clear();
    }
    syncUI();
    rebuild();
  });

  function syncUI() {
    const nSel = state.districts.size;
    const nAll = allDistricts.length;
    state.allDistrictsSelected = (nSel === nAll);
    allCb.checked = nSel === nAll && nAll > 0;
    allCb.indeterminate = nSel > 0 && nSel < nAll;

    for (const [d, cb] of districtCbs.entries()) {
      cb.checked = state.districts.has(d);
    }
    const fullOkrugs = [];
    for (const node of okrugNodes) {
      const selInOk = node.ds.filter(d => state.districts.has(d)).length;
      node.okCb.checked = selInOk === node.ds.length && node.ds.length > 0;
      node.okCb.indeterminate = selInOk > 0 && selInOk < node.ds.length;
      if (node.okCb.checked) fullOkrugs.push(node.ok);
    }

    if (!summaryEl) return;
    if (nSel === nAll) {
      summaryEl.textContent = "Районы: Вся Москва";
    } else if (nSel === 0) {
      summaryEl.textContent = "Районы: ничего не выбрано (0)";
    } else if (fullOkrugs.length > 0 &&
               fullOkrugs.reduce((acc, ok) => acc + districtsByOkrug[ok].length, 0) === nSel) {
      summaryEl.textContent = `Округа: ${fullOkrugs.join(", ")}`;
    } else {
      const names = [...state.districts];
      summaryEl.textContent = names.length <= 2
        ? `Районы: ${names.join(", ")}`
        : `Районы: ${names.slice(0, 2).join(", ")} +${names.length - 2}`;
    }
  }

  if (filterInput) {
    filterInput.addEventListener("input", () => {
      const q = filterInput.value.trim().toLowerCase().replace(/ё/g, "е");
      for (const node of okrugNodes) {
        const okMatch = node.ok.toLowerCase().replace(/ё/g, "е").includes(q);
        let anyDistrict = false;
        for (const r of node.rows) {
          const dMatch = !q || okMatch || r.name.toLowerCase().replace(/ё/g, "е").includes(q);
          r.el.classList.toggle("hidden", !dMatch);
          if (dMatch) anyDistrict = true;
        }
        node.det.classList.toggle("hidden", !anyDistrict);
        if (q && anyDistrict && !okMatch) node.det.open = true;
      }
    });
  }

  syncUI();
}

function initLegend() {
  const box = document.getElementById("legend-kinds");
  for (const kind of Object.keys(kindLayers)) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = KIND_COLORS[kind] || KIND_COLORS.other;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(KIND_LABELS[kind] || kind));
    box.appendChild(item);
  }
}

/* ---------- Фильтры в легенде: стадия (формой) + год ввода ---------- */
function initLegendFilters() {
  const STATUS_SWATCH = {
    designed: "#c9c9c9", construction: "#333", operation: "#8bc34a",
  };
  const box = document.getElementById("legend-filters");
  for (const [status, label] of Object.entries(STATUS_LABELS)) {
    const label2 = document.createElement("label");
    label2.className = "legend-filter-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.status = status;
    cb.addEventListener("change", () => {
      cb.checked ? state.statuses.add(status) : state.statuses.delete(status);
      rebuild();
    });
    label2.appendChild(cb);
    label2.insertAdjacentHTML("beforeend",
      shapeSvg(status, STATUS_SWATCH[status], 14) + " " + label);
    box.appendChild(label2);
    state.statuses.add(status);
  }
  const years = [...new Set(fc.features
    .map(f => f.properties.plan_years && f.properties.plan_years.end)
    .filter(y => y != null))].sort((a, b) => a - b);
  if (years.length) {
    const sel = document.createElement("select");
    sel.id = "year-filter";
    for (const y of ["all", ...years]) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y === "all" ? "все годы" : `до ${y}`;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => { state.year = sel.value; rebuild(); });
    const row = document.createElement("label");
    row.className = "legend-filter-item";
    row.append(" год ввода: ", sel);
    box.appendChild(row);
  }
  // Пометки проблем геометрии (2026-11-06): скрыть/показать объекты с ⚠
  const issueCount = fc.features.filter(f => (f.properties.geo_issues || []).length).length;
  if (issueCount) {
    const row = document.createElement("label");
    row.className = "legend-filter-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.addEventListener("change", () => {
      state.hideIssues = cb.checked;
      rebuild();
    });
    row.appendChild(cb);
    row.append(` скрыть с ⚠ геометрией (${issueCount})`);
    box.appendChild(row);
  }
}

initPanel();
initLegend();
initLegendFilters();
initSearch();
rebuild();
/* Вид из URL: ?lat=55.83&lon=37.42&z=14&base=osm — шэринг/визуальные гейты
   (base=osm — без тайлов Яндекса, которые не грузятся из РФ/песочницы);
   без параметров — вся Москва. */
const urlView = new URLSearchParams(window.location.search);
const iniLat = parseFloat(urlView.get("lat"));
const iniLon = parseFloat(urlView.get("lon"));
const iniZ = parseInt(urlView.get("z") || "", 10);
if (urlView.get("base") === "osm") {
  map.removeLayer(yandexTiles);
  map.addLayer(osmTiles);
}
if (Number.isFinite(iniLat) && Number.isFinite(iniLon) && Number.isFinite(iniZ)) {
  map.setView([iniLat, iniLon], iniZ);
} else if (fc.features.length) {
  map.fitBounds(geojsonLayer.getBounds().pad(0.1), { maxZoom: 14 });
} else {
  map.setView([55.75, 37.62], 10);  // центр Москвы, если данных нет
  toast("Нет данных: выполните fetch_* и build_geo");
}
window.map = map;  // для отладки/проверок из консоли
