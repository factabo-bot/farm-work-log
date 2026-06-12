"use strict";

// 進捗ボード（閲覧専用）
// 日別モード: 指定日にどこで何をやったかを配置図と一覧で見る
// 週間モード: 作業ごとに「最後にやってから何日たったか」をヒートマップで見る

const state = {
  mode: "day",          // "day" | "week"
  date: formatDateStr(new Date()),
  base: MASTERS.bases[0],
  building: null,
  workFilter: null,     // 日別: null=全部 ／ 週間: 必ずどれか1つ
  records: [],          // 日別モードの記録
  status: new Map(),    // 週間モード "拠点|棟|列|位置|作業" → 最後にやった日
  mock: !CONFIG.GAS_URL,
};

const $ = (id) => document.getElementById(id);
const MS_DAY = 24 * 60 * 60 * 1000;

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

  renderModes();
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

function setMode(mode) {
  state.mode = mode;
  if (mode === "week" && !state.workFilter) state.workFilter = MASTERS.works[0];
  $("date-nav-sec").hidden = mode === "week";
  $("list-sec").hidden = mode === "week";
  $("work-filter-title").textContent = mode === "week" ? "作業を選ぶ" : "作業でしぼる";
  renderModes();
  renderWorkFilter();
  refresh();
}

// 連打や通信の遅延で応答が前後しても、最後に要求した結果だけを画面に反映する
let loadSeq = 0;

async function refresh() {
  const seq = ++loadSeq;
  $("grid-loading").textContent = "（読み込み中…）";
  if (state.mode === "day") {
    $("list-title").textContent = "記録一覧（読み込み中…）";
    const result = await fetchRecordsFor(state.date);
    if (seq !== loadSeq) return;
    state.records = result.records;
    $("grid-loading").textContent = result.ok ? "" : "（読み込み失敗）";
    renderGrid();
    renderList();
    if (!result.ok) {
      $("list-title").textContent = "記録一覧（読み込み失敗）";
      $("record-list").innerHTML = "";
      $("record-list").appendChild(
        el("div", "hint", "通信に失敗しました。日付を切り替え直すか、ページを再読み込みしてください")
      );
    }
  } else {
    const result = await fetchStatus();
    if (seq !== loadSeq) return;
    state.status = result.status;
    $("grid-loading").textContent = result.ok ? "" : "（読み込み失敗）";
    renderGrid();
  }
}

// ---------- データ取得 ----------

async function fetchRecordsFor(date) {
  if (state.mock) {
    const all = JSON.parse(localStorage.getItem("farmlog_records") || "[]");
    return { ok: true, records: all.filter((r) => r.date === date) };
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(
        CONFIG.GAS_URL + "?action=records&date=" + date + "&_=" + Date.now()
      );
      const data = await res.json();
      return { ok: true, records: data.records || [] };
    } catch (err) {
      console.warn("記録の取得に失敗（試行" + attempt + "）", err);
    }
  }
  return { ok: false, records: [] };
}

async function fetchStatus() {
  const map = new Map();
  if (state.mock) {
    const all = JSON.parse(localStorage.getItem("farmlog_records") || "[]");
    all.forEach((r) => {
      addStatusEntry(map, [r.base, r.building, r.row, r.pos, r.work].join("|"), r.date);
    });
    return { ok: true, status: map };
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(CONFIG.GAS_URL + "?action=status&days=30&_=" + Date.now());
      const data = await res.json();
      Object.entries(data.status || {}).forEach(([k, v]) => addStatusEntry(map, k, v));
      return { ok: true, status: map };
    } catch (err) {
      console.warn("作業状況の取得に失敗（試行" + attempt + "）", err);
    }
  }
  return { ok: false, status: map };
}

// ---------- マスタ参照 ----------

function buildingsOfBase() {
  return MASTERS.buildings.filter((b) => b.base === state.base);
}

function positionsOf(b) {
  return b && b.positions && b.positions.length ? b.positions : [""];
}

function isFree(b) {
  return !!(b && b.type === "free");
}

// 旧方式（奥/手前・入口側/奥側）の位置の値を、現在の棟の位置区分に読み替える
function normPos(b, pos) {
  const positions = positionsOf(b);
  if (positions.length === 1) return positions[0];
  return positions.includes(pos) ? pos : positions[0];
}

// 「拠点|棟|列|位置|作業」のキーを正規化して、最新の日付でmapに入れる
function addStatusEntry(map, key, dateStr) {
  const p = key.split("|");
  const b = MASTERS.buildings.find((x) => x.base === p[0] && x.name === p[1]);
  const nk = [p[0], p[1], p[2], normPos(b, p[3]), p[4]].join("|");
  if (!map.has(nk) || map.get(nk) < dateStr) map.set(nk, dateStr);
}

// 絞り込みに使う作業一覧（棟限定の作業＝出荷調整なども含める）
function filterWorks() {
  const list = [...MASTERS.works];
  MASTERS.buildings.forEach((b) => {
    (b.extraWorks || []).forEach((w) => {
      if (!list.includes(w)) {
        const idx = list.indexOf("その他");
        list.splice(idx < 0 ? list.length : idx, 0, w);
      }
    });
  });
  return list;
}

// ---------- 描画 ----------

function renderModes() {
  const box = $("mode-buttons");
  box.innerHTML = "";
  [["day", "📅 日別"], ["week", "🌡 週間（経過日数）"]].forEach(([mode, label]) => {
    const btn = el("button", "btn" + (state.mode === mode ? " active" : ""), label);
    btn.addEventListener("click", () => setMode(mode));
    box.appendChild(btn);
  });
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
  if (state.mode === "day") {
    const all = el("button", "btn" + (state.workFilter === null ? " active" : ""), "全部");
    all.addEventListener("click", () => {
      state.workFilter = null;
      renderWorkFilter();
      renderGrid();
    });
    box.appendChild(all);
  }
  filterWorks().forEach((w) => {
    const btn = el("button", "btn" + (w === state.workFilter ? " active" : ""), w);
    btn.addEventListener("click", () => {
      if (state.mode === "week") {
        state.workFilter = w;
      } else {
        state.workFilter = w === state.workFilter ? null : w;
      }
      renderWorkFilter();
      renderGrid();
    });
    box.appendChild(btn);
  });
}

// 日別: 表示中の棟のマスごとに、その日やった作業のSet
function cellWorksMap() {
  const map = new Map();
  state.records
    .filter((r) => r.base === state.base && r.building === state.building.name)
    .forEach((r) => {
      if (r.row === "" || r.row === undefined) return;
      // 旧方式の位置の値（奥/手前など）も現在の区分に読み替えて拾う
      const key = r.row + "|" + normPos(state.building, r.pos);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(r.work);
    });
  return map;
}

// 週間: 選択中の作業を最後にやってからの日数 → 0〜6日とそれ以上の8段階
function cellHeat(col, pos) {
  const key = [state.base, state.building.name, col, pos, state.workFilter].join("|");
  const last = state.status.get(key);
  if (!last) return { cls: " age7", label: "" };
  const days = Math.round(
    (new Date(formatDateStr(new Date()) + "T00:00:00") - new Date(last + "T00:00:00")) / MS_DAY
  );
  const step = days >= 7 ? 7 : Math.max(0, days);
  return { cls: " age" + step, label: days >= 7 ? "7+" : String(days) };
}

function renderGrid() {
  const area = $("grid-area");
  area.innerHTML = "";
  const b = state.building;
  if (!b) return;

  if (isFree(b)) {
    area.appendChild(el("div", "hint", "この場所には配置図がありません（記録は一覧に表示されます）"));
    $("grid-hint").textContent = "";
    return;
  }

  $("grid-hint").textContent =
    state.mode === "day"
      ? "緑＝記録あり（文字はやった作業）"
      : "数字＝最後にやってから何日たったか（青＝最近 → 赤＝7日以上 or 記録なし）";

  const positions = positionsOf(b);
  const worksMap = state.mode === "day" ? cellWorksMap() : null;
  const wrap = el("div", "bar-grid");

  for (let col = 1; col <= b.cols; col++) {
    const row = el("div", "bar-row");
    row.appendChild(el("div", "bar-label", col + "列"));
    positions.forEach((pos) => {
      let cls = "bar-cell";
      let label = "";
      if (state.mode === "day") {
        const works = worksMap.get(col + "|" + pos);
        const filled = works && (state.workFilter === null || works.has(state.workFilter));
        if (filled) cls += " filled";
        label = works ? [...works].map(workAbbr).slice(0, 5).join("・") : "";
      } else {
        const heat = cellHeat(col, pos);
        cls += heat.cls;
        label = heat.label;
      }
      row.appendChild(el("div", cls, label));
    });
    wrap.appendChild(row);
    if (b.centerAfter === col && col < b.cols) {
      wrap.appendChild(el("div", "center-aisle", "柱・中央通路"));
    } else if ((b.aisleAfter || []).includes(col) && col < b.cols) {
      wrap.appendChild(el("div", "aisle-h", ""));
    }
  }

  // 左端に上から下まで通しの「入口」ブロック。進捗ボードは上下圧縮表示（compact）
  const outer = el("div", "bar-wrap compact");
  outer.appendChild(el("div", "entrance-block", "入口"));
  outer.appendChild(wrap);
  area.appendChild(outer);
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

    const groups = new Map();
    mine.forEach((r) => {
      const work = r.work === "その他" && r.workDetail ? `その他（${r.workDetail}）` : r.work;
      const gkey = [r.base, r.building, work].join("\t");
      if (!groups.has(gkey)) groups.set(gkey, []);
      if (r.row !== "" && r.row !== undefined) {
        groups.get(gkey).push({ row: Number(r.row), pos: r.pos });
      }
    });
    groups.forEach((cells, gkey) => {
      const [base, building, work] = gkey.split("\t");
      const b = MASTERS.buildings.find((x) => x.base === base && x.name === building);
      const place = cells.length > 0 ? " " + summarizeCells(cells, positionsOf(b)) : "";
      const line = el("div", "item");
      line.appendChild(el("span", "", `${base} ${building}${place} / ${work}`));
      box.appendChild(line);
    });

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

function summarizeCells(cells, allPositions) {
  allPositions = allPositions || [""];
  const byRow = {};
  cells.forEach((c) => {
    (byRow[c.row] = byRow[c.row] || new Set()).add(c.pos);
  });
  const whole = [];
  const partial = {};
  Object.entries(byRow).forEach(([row, set]) => {
    if (allPositions.length <= 1 || set.size >= allPositions.length) {
      whole.push(Number(row));
    } else {
      set.forEach((pos) => (partial[pos] = partial[pos] || []).push(Number(row)));
    }
  });
  const parts = [];
  if (whole.length > 0) parts.push(rangesText(whole) + "列");
  const posOrder = [...allPositions, ...Object.keys(partial).filter((p) => !allPositions.includes(p))];
  posOrder.forEach((pos) => {
    if (partial[pos]) parts.push(rangesText(partial[pos]) + "列(" + pos + ")");
  });
  return parts.join(" ");
}

function rangesText(rows) {
  rows.sort((a, b) => a - b);
  const ranges = [];
  let start = rows[0], prev = rows[0];
  for (let i = 1; i <= rows.length; i++) {
    if (rows[i] === prev + 1) { prev = rows[i]; continue; }
    ranges.push(start === prev ? `${start}` : `${start}〜${prev}`);
    start = prev = rows[i];
  }
  return ranges.join(",");
}
