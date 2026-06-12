"use strict";

// 進捗ボード（閲覧専用）。指定日の記録を配置図と一覧で表示する

const state = {
  date: formatDateStr(new Date()),
  base: MASTERS.bases[0],
  building: null,      // 選択中の棟オブジェクト
  workFilter: null,    // 絞り込み中の作業名（null=全部）
  records: [],         // 表示日の全記録（全拠点分）
  mock: !CONFIG.GAS_URL,
};

const $ = (id) => document.getElementById(id);

init();

async function init() {
  $("date-input").value = state.date;
  $("date-input").addEventListener("change", () => {
    if ($("date-input").value) {
      state.date = $("date-input").value;
      refresh();
    }
  });
  $("prev-day").addEventListener("click", () => shiftDate(-1));
  $("next-day").addEventListener("click", () => shiftDate(1));

  renderBases();
  selectBuilding(buildingsOfBase()[0]);
  renderWorkFilter();
  await refresh();
}

function shiftDate(days) {
  const d = new Date(state.date + "T00:00:00");
  d.setDate(d.getDate() + days);
  state.date = formatDateStr(d);
  $("date-input").value = state.date;
  refresh();
}

async function refresh() {
  await loadRecords();
  renderGrid();
  renderList();
}

// ---------- データ取得 ----------

async function loadRecords() {
  state.records = [];
  if (state.mock) {
    const all = JSON.parse(localStorage.getItem("farmlog_records") || "[]");
    state.records = all.filter((r) => r.date === state.date);
    return;
  }
  try {
    const res = await fetch(CONFIG.GAS_URL + "?action=records&date=" + state.date);
    const data = await res.json();
    state.records = data.records || [];
  } catch (err) {
    console.warn("記録の取得に失敗", err);
  }
}

// ---------- 描画 ----------

function buildingsOfBase() {
  return MASTERS.buildings.filter((b) => b.base === state.base);
}

function renderBases() {
  const box = $("base-buttons");
  box.innerHTML = "";
  MASTERS.bases.forEach((base) => {
    const btn = el("button", "btn" + (base === state.base ? " active" : ""), base);
    btn.addEventListener("click", () => {
      state.base = base;
      renderBases();
      selectBuilding(buildingsOfBase()[0]);
    });
    box.appendChild(btn);
  });
}

function selectBuilding(building) {
  state.building = building;
  renderBuildings();
  renderGrid();
}

function renderBuildings() {
  const box = $("building-buttons");
  box.innerHTML = "";
  buildingsOfBase().forEach((b) => {
    const btn = el("button", "btn" + (b === state.building ? " active" : ""), b.name);
    btn.addEventListener("click", () => selectBuilding(b));
    box.appendChild(btn);
  });
}

function renderWorkFilter() {
  const box = $("work-filter");
  box.innerHTML = "";
  const all = el("button", "btn" + (state.workFilter === null ? " active" : ""), "全部");
  all.addEventListener("click", () => {
    state.workFilter = null;
    renderWorkFilter();
    renderGrid();
  });
  box.appendChild(all);
  MASTERS.works.forEach((w) => {
    const btn = el("button", "btn" + (w === state.workFilter ? " active" : ""), w);
    btn.addEventListener("click", () => {
      state.workFilter = w === state.workFilter ? null : w;
      renderWorkFilter();
      renderGrid();
    });
    box.appendChild(btn);
  });
}

// 表示中の棟のマスごとに、その日やった作業のSetを作る
function cellWorksMap() {
  const map = new Map();
  state.records
    .filter((r) => r.base === state.base && r.building === state.building.name)
    .forEach((r) => {
      const key = r.row + "|" + r.pos;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(r.work);
    });
  return map;
}

function renderGrid() {
  const area = $("grid-area");
  area.innerHTML = "";
  const b = state.building;
  if (!b) return;
  const worksMap = cellWorksMap();

  const flex = el("div", "grid-flex");
  const labelCol = el("div", "grid-col label-col");
  labelCol.appendChild(el("div", "col-num", ""));
  b.positions.forEach((pos) => labelCol.appendChild(el("div", "row-label", pos)));
  flex.appendChild(labelCol);

  for (let col = 1; col <= b.cols; col++) {
    const colDiv = el("div", "grid-col");
    colDiv.appendChild(el("div", "col-num", String(col)));
    b.positions.forEach((pos) => {
      const works = worksMap.get(col + "|" + pos);
      const filled = works && (state.workFilter === null || works.has(state.workFilter));
      const label = works ? [...works].map(workAbbr).slice(0, 4).join("\n") : "";
      colDiv.appendChild(el("div", "cell" + (filled ? " filled" : ""), label));
    });
    flex.appendChild(colDiv);
    if ((b.aisleAfter || []).includes(col) && col < b.cols) {
      flex.appendChild(el("div", "aisle-v", ""));
    }
  }

  const inner = el("div", "grid-inner");
  inner.appendChild(flex);
  inner.appendChild(el("div", "entrance", "▲ 入口（妻面中央）"));
  area.appendChild(inner);
}

// その日の記録一覧（全拠点分）。記録者ごとに棟×作業でまとめる
function renderList() {
  const recorders = [...new Set(state.records.map((r) => r.recorder))];
  $("list-title").textContent =
    `記録一覧（${state.records.length}件・${recorders.length}人）`;

  const box = $("record-list");
  box.innerHTML = "";
  if (state.records.length === 0) {
    box.appendChild(el("div", "hint", "この日の記録はありません"));
    return;
  }

  recorders.forEach((recorder) => {
    box.appendChild(el("div", "recorder-head", recorder));
    const mine = state.records.filter((r) => r.recorder === recorder);

    // 拠点|棟|作業 ごとにマスをまとめて1行にする
    const groups = new Map();
    mine.forEach((r) => {
      const work = r.work === "その他" && r.workDetail ? `その他（${r.workDetail}）` : r.work;
      const gkey = [r.base, r.building, work].join("|");
      if (!groups.has(gkey)) groups.set(gkey, []);
      groups.get(gkey).push({ row: Number(r.row), pos: r.pos });
    });
    groups.forEach((cells, gkey) => {
      const [base, building, work] = gkey.split("|");
      const line = el("div", "item");
      line.appendChild(el("span", "", `${base} ${building} ${summarizeCells(cells)} / ${work}`));
      box.appendChild(line);
    });

    // 備考（同じ送信の行に重複して入るので、重複を除いて表示）
    [...new Set(mine.map((r) => r.note).filter((n) => n))].forEach((note) => {
      const line = el("div", "item note-item");
      line.appendChild(el("span", "", `📝 ${note}`));
      box.appendChild(line);
    });
  });
}

// ---------- 小物 ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function formatDateStr(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function workAbbr(w) {
  return w === "その他" ? "他" : w.charAt(0);
}

// 連続したマス選択を「3〜5列(奥)」のような短い表記にまとめる
function summarizeCells(cells) {
  const byPos = {};
  cells.forEach((c) => (byPos[c.pos] = byPos[c.pos] || []).push(c.row));
  return Object.entries(byPos)
    .map(([pos, rows]) => {
      rows.sort((a, b) => a - b);
      const ranges = [];
      let start = rows[0], prev = rows[0];
      for (let i = 1; i <= rows.length; i++) {
        if (rows[i] === prev + 1) { prev = rows[i]; continue; }
        ranges.push(start === prev ? `${start}` : `${start}〜${prev}`);
        start = prev = rows[i];
      }
      return `${ranges.join(",")}列(${pos})`;
    })
    .join(" ");
}
