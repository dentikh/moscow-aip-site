/* Редактор раскладки листов: перетаскивание, обрезка, экспорт layout.json. */
"use strict";

(function () {
  const RENDERS = (typeof RENDERS_INDEX !== "undefined" && RENDERS_INDEX) || { issues: [] };
  const STORE_KEY = "aip-layouts";
  const $ = (id) => document.getElementById(id);

  const map = L.map("board", {
    crs: L.CRS.Simple, minZoom: -3, maxZoom: 6,
    center: [0, 0], zoom: -1, zoomSnap: 0.5,
  });
  map.attributionControl.setPrefix("");
  window.map = map;  // для проверок из консоли

  let seriesList = [];
  let model = null;   // {issue, seriesId, tiles:[{page,file,x,y,w,h,crop:{l,t,r,b}}]}
  let layers = {};    // page -> imageOverlay
  let selected = null;

  function resolveUrl(u) {
    return u && !/^(https?:|data:|\/)/.test(u) ? "../" + u : u;
  }

  function flattenSeries() {
    for (const issue of RENDERS.issues || []) {
      for (const s of issue.series || []) {
        seriesList.push({ issue: issue.id, series: s });
      }
    }
    // Только нужная пользователю серия (правка 2026-10-04); fallback — все
    const wanted = seriesList.filter((e) =>
      (e.series.title || "").includes("Назначение территории") ||
      /назначени/i.test(e.series.title || e.series.id || ""));
    if (wanted.length) seriesList = wanted;
  }

  function defaultModel(entry) {
    const s = entry.series;
    const files = s.files || [];
    const cols = Math.max(1, Math.ceil(Math.sqrt(files.length)));
    const gap = 40;
    const tiles = files.map((f, i) => ({
      page: (s.sheet_pages || s.pages || [])[i] || i + 1,
      file: f,
      // 4 колонки, номера сверху вниз внутри колонки (col-major)
      x: Math.floor(i / 4) * 2020 + gap,
      y: (i % 4) * 2900 + gap,
      w: 1984, h: 2806,
      crop: { l: 0, t: 0, r: 0, b: 0 },
    }));
    return { issue: entry.issue, seriesId: s.id, title: s.title || s.id, tiles };
  }

  function storedModel(entry) {
    try {
      const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      const m = all[`${entry.issue}/${entry.series.id}`];
      return m || null;
    } catch (e) { return null; }
  }

  function saveToStorage() {
    if (!model) return;
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    all[`${model.issue}/${model.seriesId}`] = model;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
    toast("Раскладка сохранена");
  }

  function toast(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);" +
      "background:#333;color:#fff;padding:6px 12px;border-radius:6px;z-index:9999";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function place(tile) {
    const ly = layers[tile.page];
    if (!ly) return;
    /* экранные оси: x вправо, y ВНИЗ; Leaflet lat растёт вверх → минус */
    const bounds = [[-(tile.y + tile.h), tile.x], [-tile.y, tile.x + tile.w]];
    ly.setBounds(L.latLngBounds(bounds[0], bounds[1]));
    applyClip(tile);
  }

  /* clip-path задаётся в ЭКРАННЫХ px элемента, а кроп храним в пикселях
     ИЗОБРАЖЕНИЯ → пересчёт через текущий масштаб и обновление на зумах */
  function applyClip(tile) {
    const ly = layers[tile.page];
    const img = ly && ly.getElement();
    if (!img) return;
    const kx = (img.offsetWidth / tile.w) || 1;
    const ky = (img.offsetHeight / tile.h) || 1;
    const c = tile.crop;
    img.style.clipPath = `inset(${(c.t * ky).toFixed(1)}px ${(c.r * kx).toFixed(1)}px ` +
      `${(c.b * ky).toFixed(1)}px ${(c.l * kx).toFixed(1)}px)`;
  }

  function reclipAll() {
    if (model) model.tiles.forEach(applyClip);
  }
  map.on("zoomend", reclipAll);
  map.on("zoom", reclipAll);

  function drawAll() {
    Object.values(layers).forEach((l) => map.removeLayer(l));
    layers = {};
    for (const t of model.tiles) {
      const ly = L.imageOverlay(resolveUrl(t.file),
        [[t.y, t.x], [t.y + t.h, t.x + t.w]], { opacity: 1 }).addTo(map);
      ly.on("click", () => selectTile(t.page));
      layers[t.page] = ly;
      place(t);
    }
    const xs = model.tiles.flatMap((t) => [t.x, t.x + t.w]);
    const ys = model.tiles.flatMap((t) => [t.y, t.y + t.h]);
    map.fitBounds([[-Math.max(...ys), Math.min(...xs)], [-Math.min(...ys), Math.max(...xs)]]);
  }

  function selectTile(page) {
    selected = page;
    document.querySelectorAll("#tiles .tl").forEach((el) =>
      el.classList.toggle("sel", +el.dataset.page === page));
    Object.entries(layers).forEach(([p, ly]) =>
      ly.getElement() && ly.getElement().classList.toggle("sel", +p === page));
    const t = model.tiles.find((x) => x.page === page);
    if (t) {
      $("cl").value = t.crop.l; $("ct").value = t.crop.t;
      $("cr").value = t.crop.r; $("cb").value = t.crop.b;
    }
  }

  function renderTileList() {
    const box = $("tiles");
    box.innerHTML = "";
    for (const t of model.tiles) {
      const el = document.createElement("div");
      el.className = "tl";
      el.dataset.page = t.page;
      el.innerHTML = `<span>стр. ${t.page}</span><span style="color:#777">${t.x},${t.y}</span>`;
      el.addEventListener("click", () => selectTile(t.page));
      box.appendChild(el);
    }
  }

  async function loadSeries(entry) {
    model = storedModel(entry) || defaultModel(entry);
    // предраскладка из renders_store/<issue>/layout.json (обрезка от белого)
    try {
      const resp = await fetch(
        `../renders_store/${entry.issue}/layout.json`, { cache: "no-store" });
      if (resp.ok) {
        const pre = await resp.json();
        if (pre && pre.series === entry.series.id && Array.isArray(pre.tiles)) {
          for (const pt of pre.tiles) {
            const t = model.tiles.find((x) => x.page === pt.page);
            if (t) {
              t.x = pt.x; t.y = pt.y;
              t.crop = pt.crop || t.crop;
            }
          }
        }
      }
    } catch (e) { /* нет файла — стартовая сетка */ }
    renderTileList();
    drawAll();
    setAllOpacity();
    selected = null;
  }

  /* --- перетаскивание --- */
  let drag = null;
  let lastPicked = null;
  map.on("mousedown", (e) => {
    const p = e.latlng;
    const my = -p.lat;  // модельный y = -lat (ось развёрнута)
    /* захват только по ВИДИМОЙ (кропнутой) части тайла */
    const hits = model.tiles.filter((t) => {
      const c = t.crop || { l: 0, t: 0, r: 0, b: 0 };
      return my >= t.y + c.t && my <= t.y + t.h - c.b &&
             p.lng >= t.x + c.l && p.lng <= t.x + t.w - c.r;
    });
    if (!hits.length) return;
    let t = hits[hits.length - 1];  // верхний в стопке
    const alt = e.originalEvent && e.originalEvent.altKey;
    if (alt && lastPicked) {
      const i = hits.indexOf(hits.find((x) => x.page === lastPicked));
      if (i >= 0) t = hits[(i + 1) % hits.length];  // Alt — следующий под курсором
    }
    lastPicked = t.page;
    selectTile(t.page);
    drag = { tile: t, start: { x: p.lng, y: p.lat }, orig: { x: t.x, y: t.y } };
    map.dragging.disable();
  });
  map.on("mousemove", (e) => {
    if (!drag) return;
    const t = drag.tile;
    t.x = Math.round(drag.orig.x + (e.latlng.lng - drag.start.x));
    t.y = Math.round(drag.orig.y - (e.latlng.lat - drag.start.y));
    place(t);
    renderTileList();
    if (selected === t.page) selectTile(t.page);
  });
  map.on("mouseup", () => { drag = null; map.dragging.enable(); });

  document.addEventListener("keydown", (e) => {
    if (!model || !selected) return;
    const t = model.tiles.find((x) => x.page === selected);
    if (!t) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT") return;
    const step = e.shiftKey ? 10 : 1;
    const moves = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      t.x += moves[e.key][0]; t.y += moves[e.key][1];
      place(t); renderTileList(); selectTile(t.page);
    }
  });

  function setAllOpacity() {
    const v = ($("opacity").value || 55) / 100;
    Object.values(layers).forEach((ly) => ly.setOpacity(v));
  }

  $("opacity").addEventListener("input", setAllOpacity);
  $("apply-crop").addEventListener("click", () => {
    if (!selected) return toast("Сначала выбери тайл");
    const t = model.tiles.find((x) => x.page === selected);
    t.crop = { l: +$("cl").value || 0, t: +$("ct").value || 0,
               r: +$("cr").value || 0, b: +$("cb").value || 0 };
    place(t);
    toast(`Обрезка стр. ${t.page}: L${t.crop.l} T${t.crop.t} R${t.crop.r} B${t.crop.b}`);
  });
  $("crop-all").addEventListener("click", () => {
    if (!selected) return toast("Сначала выбери тайл-образец");
    const t = model.tiles.find((x) => x.page === selected);
    const c = { ...t.crop };
    model.tiles.forEach((x) => { x.crop = { ...c }; place(x); });
    toast(`Обрезка применена ко всем: L${c.l} T${c.t} R${c.r} B${c.b}`);
  });
  $("save").addEventListener("click", saveToStorage);
  $("reset").addEventListener("click", () => {
    if (!model) return;
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    delete all[`${model.issue}/${model.seriesId}`];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
    const sel = $("series");
    loadSeries(seriesList[+sel.value]);
    toast("Сброшено к авто-раскладке");
  });
  $("export").addEventListener("click", () => {
    if (!model) return;
    const layout = {
      issue: model.issue, series: model.seriesId, title: model.title,
      tiles: model.tiles.map((t) => ({ file: t.file, page: t.page, x: t.x, y: t.y, crop: t.crop })),
    };
    const blob = new Blob([JSON.stringify(layout, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `layout_${model.seriesId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  flattenSeries();
  const sel = $("series");
  seriesList.forEach((entry, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${entry.issue} · ${entry.series.title || entry.series.id}`;
    sel.appendChild(opt);
  });
  if (seriesList.length) {
    sel.addEventListener("change", () => loadSeries(seriesList[+sel.value]));
    loadSeries(seriesList[0]);
  } else {
    $("panel").insertAdjacentHTML("beforeend",
      '<p class="hint">Серии не найдены — запусти извлечение.</p>');
  }
})();
