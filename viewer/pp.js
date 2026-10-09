/* Постановления Вестника: список ПП выпуска, карточка резюме, таблицы —
   картинкой (правило пользователя), связь с сериями чертежей.
   Зависит от app.js (toast), renders.js (openGallery). */
"use strict";

(function () {
  const PP = (typeof PP_INDEX !== "undefined" && PP_INDEX) || { issues: [] };
  const RENDERS = (typeof RENDERS_INDEX !== "undefined" && RENDERS_INDEX) || { issues: [] };

  const $ = (id) => document.getElementById(id);

  const TYPE_LABELS = {
    krt: "КРТ", ppt: "ППТ", pzz: "ПЗЗ", pzz_change: "изм. ПЗЗ",
    nature: "природные", other: "прочее",
  };
  const TYPE_COLORS = {
    krt: "#c62828", ppt: "#1565c0", pzz: "#6a1b9a", pzz_change: "#6a1b9a",
    nature: "#2e7d32", other: "#616161",
  };

  /* series id -> stitched (для кнопки «Чертежи серии») */
  const stitchedBySeries = {};
  for (const issue of RENDERS.issues || []) {
    for (const s of issue.series || []) {
      stitchedBySeries[s.id] = s.stitched || (s.files || [])[0];
    }
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function badge(type) {
    const b = el("span", "pp-badge");
    b.textContent = TYPE_LABELS[type] || type;
    b.style.background = TYPE_COLORS[type] || "#616161";
    return b;
  }

  /* ---------- Список ПП ---------- */
  function buildPpList() {
    const box = $("pp-list");
    let count = 0;
    for (const issue of PP.issues || []) {
      for (const d of issue.decrees || []) {
        count++;
        const item = el("div", "series-item pp-item");
        item.append(badge(d.summary && d.summary.type));
        const head = el("div", "series-title");
        head.textContent = `${d.pp} от ${d.date}`;
        item.append(head);
        const meta = el("div", "series-meta");
        const terr = d.summary && d.summary.territory;
        const bits = [`стр. ${d.pages.start}–${d.pages.end}`];
        if (terr && terr.area_ga) bits.push(`${terr.area_ga} га`);
        if ((d.tables || []).length) bits.push(`таблиц: ${d.tables.length}`);
        meta.textContent = bits.join(" · ");
        item.append(meta);
        const t = el("div", "pp-title-snippet");
        t.textContent = d.title;
        item.append(t);
        item.addEventListener("click", () => showDecree(issue, d));
        box.appendChild(item);
      }
    }
    if (!count) {
      box.innerHTML = '<div class="series-meta">ПП не найдены: запустите py scripts/build_pp_index.py.</div>';
    }
  }

  /* ---------- Карточка ПП ---------- */
  function showDecree(issue, d) {
    const box = $("pp-list");
    box.innerHTML = "";
    const card = el("div", "series-item pp-card");
    const back = el("button", "small", "← все постановления");
    back.addEventListener("click", () => { box.innerHTML = ""; buildPpList(); });
    card.append(back);

    const head = el("div", "series-title");
    head.append(badge(d.summary.type), el("span", null, ` ${d.pp} от ${d.date}`));
    card.append(head);
    card.append(el("div", "series-meta",
      `${issue.id} · стр. ${d.pages.start}–${d.pages.end}`));
    card.append(el("div", "pp-title-snippet", d.title));

    const sum = el("div", "pp-summary");
    sum.textContent = d.summary.summary;
    card.append(sum);

    const terr = d.summary.territory;
    if (terr && (terr.address || terr.area_ga)) {
      const line = el("div", "series-meta");
      line.textContent = `Территория: ${terr.address || ""}${terr.address && terr.area_ga ? " · " : ""}${terr.area_ga ? terr.area_ga + " га" : ""}`;
      card.append(line);
    }
    for (const term of d.summary.terms || []) {
      card.append(el("div", "series-meta", `${term.label}: ${term.value}`));
    }
    for (const ex of d.summary.executors || []) {
      card.append(el("div", "series-meta", `${ex.org} (ИНН ${ex.inn})`));
    }

    if ((d.tables || []).length) {
      card.append(el("div", "legend-sep"));
      card.append(el("div", "series-title", "Таблицы"));
      for (const t of d.tables) {
        const label = el("div", "series-meta",
          `стр. ${t.page}${t.pages_count > 1 ? `–${t.page + t.pages_count - 1}` : ""} · ${t.rows.length} строк`);
        card.append(label);
        const img = document.createElement("img");
        img.loading = "lazy";
        img.className = "pp-table-img";
        img.src = t.png ? "../" + t.png : "";
        img.alt = `Таблица ${t.table_id}`;
        img.addEventListener("click", () => openGallery(t.png));
        img.onerror = () => {
          img.replaceWith(el("div", "series-meta", "файл недоступен"));
        };
        card.append(img);
      }
    }

    if ((d.series || []).length) {
      card.append(el("div", "legend-sep"));
      card.append(el("div", "series-title", "Чертежи серии"));
      for (const s of d.series) {
        const row = el("div", "series-meta");
        const btn = el("button", "small", "Открыть сшитый");
        btn.addEventListener("click", () => {
          const url = stitchedBySeries[s.id];
          if (url) openGallery(url);
          else toast("Сшивка серии не найдена");
        });
        row.append(el("span", null,
          `${s.title || s.id}${s.series_approx ? " (≈)" : ""}`), document.createTextNode(" "), btn);
        card.append(row);
      }
    }
    box.appendChild(card);
  }

  buildPpList();
})();
