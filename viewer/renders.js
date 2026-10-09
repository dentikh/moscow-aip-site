/* Чертежи/рендеры Вестника: галерея, наложение текстурой, оцифровка элементов.
   Зависит от app.js (map, KIND_COLORS, KIND_LABELS, toast, escapeHtml). */
"use strict";

(function () {
  const RENDERS = (typeof RENDERS_INDEX !== "undefined" && RENDERS_INDEX) || { issues: [] };
  const OVERLAY_KEY = "aip-renders-overlays";
  const MANUAL_KEY = "aip-manual-features";

  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toISOString().slice(0, 10);
  /* индекс хранит пути от корня репо; страница — в viewer/ */
  const resolveUrl = (u) => (u && !/^(https?:|data:|\/)/.test(u) ? "../" + u : u);

  /* ---------- Список серий ---------- */
  function buildSeriesList() {
    const box = $("series-list");
    let count = 0;
    for (const issue of RENDERS.issues || []) {
      for (const s of issue.series || []) {
        count++;
        const item = document.createElement("div");
        item.className = "series-item";
        const title = document.createElement("div");
        title.className = "series-title";
        title.textContent = s.title || s.id;
        const meta = document.createElement("div");
        meta.className = "series-meta";
        const pages = s.pages || [];
        meta.textContent = `${issue.id} · стр. ${pages[0]}–${pages[pages.length - 1]} · ${pages.length} листов`;
        const btnView = document.createElement("button");
        btnView.className = "small";
        btnView.textContent = "Сшитый чертёж";
        btnView.addEventListener("click", () => openGallery(s.stitched));
        const btnSheets = document.createElement("button");
        btnSheets.className = "small";
        btnSheets.textContent = "Листы";
        btnSheets.addEventListener("click", () => openSheetsMenu(s));
        const btnOverlay = document.createElement("button");
        btnOverlay.className = "small";
        btnOverlay.textContent = "На карту";
        btnOverlay.addEventListener("click", () => startOverlayPlacement(s));
        const btnVector = document.createElement("button");
        btnVector.className = "small";
        btnVector.textContent = "Вектор";
        btnVector.title = "Вектор-оверлей проектных линий (scripts/extract_lines.py)";
        btnVector.addEventListener("click", () => showVectorOverlay(s));
        item.append(title, meta, btnView, btnSheets, btnOverlay, btnVector);
        box.appendChild(item);
      }
    }
    if (!count) {
      box.innerHTML = '<div class="series-meta">Серии не найдены: запустите извлечение (план 2, задачи 1–4).</div>';
    }
  }

  function openSheetsMenu(series) {
    const files = series.files || [];
    if (!files.length) return openGallery(series.stitched);
    if (files.length === 1) return openGallery(files[0]);
    const box = $("series-list");
    const old = $("sheets-menu");
    if (old) old.remove();
    const menu = document.createElement("div");
    menu.id = "sheets-menu";
    menu.className = "series-meta";
    const sel = document.createElement("select");
    files.forEach((f, i) => {
      const opt = document.createElement("option");
      opt.value = f;
      const pageNo = (series.sheet_pages || series.pages || [])[i] || "?";
      opt.textContent = `стр. ${pageNo}`;
      sel.appendChild(opt);
    });
    const btn = document.createElement("button");
    btn.className = "small";
    btn.textContent = "Открыть";
    btn.addEventListener("click", () => openGallery(sel.value));
    menu.append(sel, btn);
    box.prepend(menu);
  }

  /* ---------- Галерея ---------- */
  function openGallery(url) {
    if (!url) { toast("Файл не указан"); return; }
    const gallery = $("gallery");
    const img = $("gallery-img");
    const msg = $("gallery-msg");
    img.style.display = "";
    msg.classList.add("hidden");
    img.onerror = () => { img.style.display = "none"; msg.classList.remove("hidden"); };
    img.onload = () => msg.classList.add("hidden");
    img.src = resolveUrl(url);
    gallery.classList.remove("hidden");
  }
  window.openGallery = openGallery;  // переиспользуется панелью «Постановления»

  $("gallery-close").addEventListener("click", () => $("gallery").classList.add("hidden"));
  $("gallery").addEventListener("click", (e) => {
    if (e.target === $("gallery")) $("gallery").classList.add("hidden");
  });

  /* ---------- Наложение текстурой ---------- */
  let activeOverlay = null;
  let activeOverlayInfo = null;

  function loadOverlays() {
    try { return JSON.parse(localStorage.getItem(OVERLAY_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveOverlays(list) { localStorage.setItem(OVERLAY_KEY, JSON.stringify(list)); }

  function showOverlay(url, bounds) {
    removeOverlay(false);
    activeOverlay = L.imageOverlay(resolveUrl(url), bounds, { opacity: 0.7 }).addTo(map);
    activeOverlayInfo = { url, bounds };
    $("overlay-controls").classList.remove("hidden");
  }

  function removeOverlay(updateStore) {
    if (activeOverlay) { map.removeLayer(activeOverlay); activeOverlay = null; }
    activeOverlayInfo = null;
    $("overlay-controls").classList.add("hidden");
    clearVectorOverlay(false);
    if (updateStore !== false) saveOverlays([]);
  }

  function startOverlayPlacement(series) {
    const url = series.stitched || (series.files || [])[0];
    if (!url) { toast("Нет файлов серии"); return; }
    const hint = $("dig-hint");
    hint.textContent = "Наложение: кликните ДВЕ точки — противоположные углы чертежа на карте.";
    hint.classList.remove("hidden");
    document.body.classList.add("dig-active");
    const pts = [];
    const handler = (e) => {
      pts.push([e.latlng.lat, e.latlng.lng]);
      L.circleMarker(e.latlng, { radius: 5, color: "#b00" }).addTo(map);
      if (pts.length === 2) {
        map.off("click", handler);
        document.body.classList.remove("dig-active");
        hint.classList.add("hidden");
        const bounds = L.latLngBounds(pts[0], pts[1]);
        showOverlay(url, bounds);
        saveOverlays([{ url, bounds: [[bounds.getSouth(), bounds.getWest()],
                                  [bounds.getNorth(), bounds.getEast()]] }]);
        map.fitBounds(bounds.pad(0.2));
      }
    };
    map.on("click", handler);
  }

  $("overlay-opacity").addEventListener("input", (e) => {
    if (activeOverlay) activeOverlay.setOpacity(e.target.value / 100);
  });
  $("overlay-remove").addEventListener("click", () => removeOverlay());

  function restoreOverlays() {
    const stored = loadOverlays();
    if (stored.length && stored[0].url && stored[0].bounds) {
      showOverlay(stored[0].url, stored[0].bounds);
    }
  }

  /* ---------- Вектор-оверлей проектных линий (План 3.4) ---------- */
  const VECTOR_CLASS = {
    road: { color: "#ff78c8", kind: "road", label: "Магистраль (вектор)" },
    red_line: { color: "#ff3c3c", kind: "road", label: "Красная линия (вектор)" },
    blue: { color: "#506eff", kind: "other", label: "Граница/зона (вектор)" },
  };
  let vectorLayers = [];
  let vectorSeries = null;

  /* пиксели листа -> LatLng внутри bounds наложения (y инвертирован) */
  function pxToLatLng(bounds, x, y, w, h) {
    const south = bounds.getSouth(), north = bounds.getNorth();
    const west = bounds.getWest(), east = bounds.getEast();
    return [south + (1 - y / h) * (north - south),
            west + (x / w) * (east - west)];
  }

  async function showVectorOverlay(series) {
    clearVectorOverlay(false);
    if (!activeOverlayInfo || !activeOverlayInfo.bounds) {
      toast("Сначала наложите чертёж на карту («На карту»)");
      return;
    }
    const bounds = L.latLngBounds(activeOverlayInfo.bounds);
    let gj;
    try {
      const resp = await fetch(`../data/processed/lines/${series.id}.geojson`);
      if (!resp.ok) throw new Error("нет файла");
      gj = await resp.json();
    } catch (e) {
      toast("Вектор серии недоступен: запустите scripts/extract_lines.py");
      return;
    }
    /* размеры листа — из max координат GeoJSON */
    let w = 0, h = 0;
    for (const f of gj.features) {
      for (const [x, y] of f.geometry.coordinates) {
        if (x > w) w = x;
        if (y > h) h = y;
      }
    }
    for (const f of gj.features) {
      const meta = VECTOR_CLASS[f.properties.line_class] || VECTOR_CLASS.blue;
      const latlngs = f.geometry.coordinates.map(([x, y]) =>
        pxToLatLng(bounds, x, y, w || 1, h || 1));
      const layer = L.polyline(latlngs, { color: meta.color, weight: 3,
                                          opacity: 0.9 }).addTo(map);
      layer._vectorId = f.properties._id;
      vectorLayers.push(layer);
    }
    toast(`Вектор: ${gj.features.length} линий поверх наложения`);
    const btn = document.getElementById("vector-merge");
    if (btn) btn.classList.remove("hidden");
    vectorSeries = series;
  }

  function clearVectorOverlay(updateStore) {
    vectorLayers.forEach((l) => map.removeLayer(l));
    vectorLayers = [];
    vectorSeries = null;
    const btn = document.getElementById("vector-merge");
    if (btn) btn.classList.add("hidden");
  }

  function mergeVectorIntoDigitize() {
    if (!vectorSeries) return;
    const seriesId = vectorSeries.id;
    fetch(`../data/processed/lines/${seriesId}.geojson`)
      .then((r) => r.json())
      .then((gj) => {
        const bounds = L.latLngBounds(activeOverlayInfo.bounds);
        let w = 0, h = 0;
        for (const f of gj.features) {
          for (const [x, y] of f.geometry.coordinates) {
            if (x > w) w = x;
            if (y > h) h = y;
          }
        }
        let added = 0;
        const ids = new Set(manualFeatures.map((f) => f.properties.id));
        for (const f of gj.features) {
          const meta = VECTOR_CLASS[f.properties.line_class] || VECTOR_CLASS.blue;
          const id = `auto:${seriesId}:${f.properties.line_class}:${f.geometry.coordinates[0][0]}:${f.geometry.coordinates[0][1]}:${f.geometry.coordinates.length}`;
          if (ids.has(id)) continue;
          const latlngs = f.geometry.coordinates.map(([x, y]) =>
            pxToLatLng(bounds, x, y, w || 1, h || 1));
          const coords = latlngs.map(([lat, lng]) => [lng, lat]);
          manualFeatures.push({
            type: "Feature",
            properties: {
              id, name: meta.label, kind: meta.kind, status: "designed",
              plan_years: { start: null, end: null }, zone: "manual",
              sources: [{ source: `vestnik-${seriesId}`, url: "", date: today() }],
              observations: [], renders: [],
              geometry_precision: "approximate",
            },
            geometry: { type: "LineString", coordinates: coords },
          });
          drawManualFeature(manualFeatures[manualFeatures.length - 1]);
          added++;
        }
        localStorage.setItem(MANUAL_KEY, JSON.stringify(manualFeatures));
        renderManualList();
        toast(`Влито в оцифровку: ${added} (дублей пропущено: ${gj.features.length - added})`);
      });
  }

  $("vector-merge").addEventListener("click", mergeVectorIntoDigitize);

  /* ---------- Оцифровка элементов планов ---------- */
  const dig = { active: false, pts: [], temp: null, markers: [] };
  const digLayers = [];
  let manualFeatures = [];
  try { manualFeatures = JSON.parse(localStorage.getItem(MANUAL_KEY) || "[]"); }
  catch (e) { manualFeatures = []; }

  function fillKindSelect() {
    const sel = $("dig-kind");
    for (const [kind, label] of Object.entries(KIND_LABELS)) {
      const opt = document.createElement("option");
      opt.value = kind;
      opt.textContent = label;
      sel.appendChild(opt);
    }
    sel.value = "road";
  }

  function setDigHint(text) {
    const hint = $("dig-hint");
    if (text) { hint.textContent = text; hint.classList.remove("hidden"); }
    else hint.classList.add("hidden");
  }

  function startDigitize() {
    dig.active = true;
    dig.pts = [];
    dig.temp = null;
    document.body.classList.add("dig-active");
    $("dig-start").classList.add("hidden");
    $("dig-finish").classList.remove("hidden");
    $("dig-cancel").classList.remove("hidden");
    map.doubleClickZoom.disable();
    setDigHint("Кликайте вершины; двойной клик или «Завершить» — конец линии/контура; Esc — отмена.");
    map.on("click", onDigClick);
    map.on("dblclick", finishDigitize);
  }

  function onDigClick(e) {
    if (!dig.active) return;
    dig.pts.push([e.latlng.lat, e.latlng.lng]);
    const m = L.circleMarker(e.latlng, { radius: 4, color: "#b00" }).addTo(map);
    dig.markers.push(m);
    redrawTemp();
  }

  function redrawTemp() {
    if (dig.temp) { map.removeLayer(dig.temp); dig.temp = null; }
    if (dig.pts.length < 2) return;
    const latlngs = dig.pts.map((p) => [p[0], p[1]]);
    const mode = $("dig-mode").value;
    const kind = $("dig-kind").value;
    if (mode === "polygon") {
      dig.temp = L.polygon(latlngs, { color: KIND_COLORS[kind], dashArray: "6 4", fillOpacity: 0.15 }).addTo(map);
    } else {
      dig.temp = L.polyline(latlngs, { color: KIND_COLORS[kind], dashArray: "6 4" }).addTo(map);
    }
  }

  function clearTemp() {
    if (dig.temp) { map.removeLayer(dig.temp); dig.temp = null; }
    dig.markers.forEach((m) => map.removeLayer(m));
    dig.markers = [];
    dig.pts = [];
  }

  function stopDigitize() {
    dig.active = false;
    map.off("click", onDigClick);
    map.off("dblclick", finishDigitize);
    map.doubleClickZoom.enable();
    document.body.classList.remove("dig-active");
    $("dig-start").classList.remove("hidden");
    $("dig-finish").classList.add("hidden");
    $("dig-cancel").classList.add("hidden");
    setDigHint("");
  }

  function finishDigitize() {
    if (!dig.active) return;
    const mode = $("dig-mode").value;
    const kind = $("dig-kind").value;
    const min = mode === "polygon" ? 3 : 2;
    if (dig.pts.length < min) { toast(`Нужно минимум ${min} точек`); return; }
    const coords = dig.pts.map((p) => [p[1], p[0]]);  // [lon, lat]
    let geometry;
    if (mode === "polygon") {
      const ring = coords.slice();
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        ring.push(ring[0]);
      }
      geometry = { type: "Polygon", coordinates: [ring] };
    } else {
      geometry = { type: "LineString", coordinates: coords };
    }
    const feature = {
      type: "Feature",
      properties: {
        id: `manual:${Date.now()}`,
        name: `${KIND_LABELS[kind]} (оцифровано с чертежа)`,
        kind, status: "designed",
        plan_years: { start: null, end: null },
        zone: "manual",
        sources: [{ source: "vestnik-manual", url: (activeOverlayInfo && activeOverlayInfo.url) || "", date: today() }],
        observations: [], renders: [],
        geometry_precision: "approximate",
      },
      geometry,
    };
    manualFeatures.push(feature);
    localStorage.setItem(MANUAL_KEY, JSON.stringify(manualFeatures));
    drawManualFeature(feature);
    renderManualList();
    clearTemp();
    stopDigitize();
    toast("Элемент добавлен");
  }

  function drawManualFeature(f) {
    const color = KIND_COLORS[f.properties.kind] || KIND_COLORS.other;
    const coords = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates;
    const latlngs = coords.map((c) => [c[1], c[0]]);
    const layer = f.geometry.type === "Polygon"
      ? L.polygon(latlngs, { color, weight: 3, fillOpacity: 0.2 })
      : L.polyline(latlngs, { color, weight: 4 });
    layer.addTo(map).bindPopup(f.properties.name);
    layer._manualId = f.properties.id;
    digLayers.push(layer);
  }

  function renderManualList() {
    const box = $("dig-features");
    box.innerHTML = "";
    manualFeatures.forEach((f, i) => {
      const item = document.createElement("div");
      item.className = "dig-item";
      const label = document.createElement("span");
      label.textContent = `${i + 1}. ${KIND_LABELS[f.properties.kind] || f.properties.kind} (${f.geometry.type === "Polygon" ? "полигон" : "линия"})`;
      const del = document.createElement("button");
      del.textContent = "×";
      del.title = "Удалить";
      del.addEventListener("click", () => {
        manualFeatures = manualFeatures.filter((x) => x.properties.id !== f.properties.id);
        localStorage.setItem(MANUAL_KEY, JSON.stringify(manualFeatures));
        const lyr = digLayers.find((l) => l._manualId === f.properties.id);
        if (lyr) { map.removeLayer(lyr); digLayers.splice(digLayers.indexOf(lyr), 1); }
        renderManualList();
      });
      item.append(label, del);
      box.appendChild(item);
    });
  }

  $("dig-start").addEventListener("click", startDigitize);
  $("dig-finish").addEventListener("click", finishDigitize);
  $("dig-cancel").addEventListener("click", () => { clearTemp(); stopDigitize(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (dig.active) { clearTemp(); stopDigitize(); }
      $("gallery").classList.add("hidden");
    }
  });

  $("dig-export").addEventListener("click", () => {
    if (!manualFeatures.length) { toast("Нет оцифрованных элементов"); return; }
    const fc = { type: "FeatureCollection", features: manualFeatures };
    const blob = new Blob([JSON.stringify(fc, null, 1)], { type: "application/geo+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "manual-features.geojson";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ---------- Инициализация ---------- */
  buildSeriesList();
  fillKindSelect();
  restoreOverlays();
  manualFeatures.forEach(drawManualFeature);
  renderManualList();
})();
