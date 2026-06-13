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
  history: [],          // 列なし場所（育苗ハウス等）の作業履歴
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
  setMode("day"); // 初期表示も「日別」ボタンと同じ経路にして確実に読み込む
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

// 古いHTMLがキャッシュされていても落ちないようにnullを許容する
function setGridLoading(text) {
  const e = $("grid-loading");
  if (e) e.textContent = text;
}

async function refresh() {
  const seq = ++loadSeq;
  setGridLoading("（読み込み中…）");
  const b = state.building;

  // 列のない場所（育苗ハウス等）は、日付ごとの作業履歴を表示する
  if (b && isFree(b)) {
    $("list-sec").hidden = true;
    $("date-nav-sec").hidden = true;
    if (state.mode === "day") {
      const result = await fetchRecordsFor(state.date);
      if (seq !== loadSeq) return;
      state.records = result.records;
      setGridLoading(result.ok ? "" : "（読み込み失敗）");
    } else {
      const res = await fetchHistory(state.base, b.name);
      if (seq !== loadSeq) return;
      state.history = res.records;
      setGridLoading(res.ok ? "" : "（読み込み失敗）");
    }
    renderGrid();
    return;
  }

  $("list-sec").hidden = state.mode === "week";
  $("date-nav-sec").hidden = state.mode === "week";
  if (state.mode === "day") {
    $("list-title").textContent = "記録一覧（読み込み中…）";
    const result = await fetchRecordsFor(state.date);
    if (seq !== loadSeq) return;
    state.records = result.records;
    setGridLoading(result.ok ? "" : "（読み込み失敗）");
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
    setGridLoading(result.ok ? "" : "（読み込み失敗）");
    renderGrid();
  }
}

async function fetchHistory(base, building) {
  if (state.mock) {
    const all = JSON.parse(localStorage.getItem("farmlog_records") || "[]");
    const records = all
      .filter((r) => r.base === base && r.building === building)
      .map((r) => ({ date: r.date, recorder: r.recorder, work: r.work, workDetail: r.workDetail, state: r.state }));
    return { ok: true, records };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        CONFIG.GAS_URL +
          "?action=history&base=" + encodeURIComponent(base) +
          "&building=" + encodeURIComponent(building) +
          "&days=30&_=" + Date.now()
      );
      const data = await res.json();
      return { ok: true, records: data.history || [] };
    } catch (err) {
      console.warn("履歴の取得に失敗（試行" + attempt + "）", err);
      await sleep(600);
    }
  }
  return { ok: false, records: [] };
}

// ---------- データ取得 ----------

async function fetchRecordsFor(date) {
  if (state.mock) {
    const all = JSON.parse(localStorage.getItem("farmlog_records") || "[]");
    return { ok: true, records: all.filter((r) => r.date === date) };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        CONFIG.GAS_URL + "?action=records&date=" + date + "&_=" + Date.now()
      );
      const data = await res.json();
      return { ok: true, records: data.records || [] };
    } catch (err) {
      console.warn("記録の取得に失敗（試行" + attempt + "）", err);
      await sleep(600);
    }
  }
  return { ok: false, records: [] };
}

async function fetchStatus() {
  const map = new Map();
  const put = (k, v) => {
    if (!map.has(k) || map.get(k) < v) map.set(k, v);
  };
  if (state.mock) {
    const all = JSON.parse(localStorage.getItem("farmlog_records") || "[]");
    all.forEach((r) => {
      const b = findBuilding(r.base, r.building);
      expandPositions(b, r.row, r.pos).forEach((p) =>
        put([r.base, r.building, r.row, p, r.work].join("|"), r.date)
      );
    });
    return { ok: true, status: map };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(CONFIG.GAS_URL + "?action=status&days=30&_=" + Date.now());
      const data = await res.json();
      Object.entries(data.status || {}).forEach(([k, v]) => {
        const p = k.split("|");
        const b = findBuilding(p[0], p[1]);
        expandPositions(b, p[2], p[3]).forEach((pos) =>
          put([p[0], p[1], p[2], pos, p[4]].join("|"), v)
        );
      });
      return { ok: true, status: map };
    } catch (err) {
      console.warn("作業状況の取得に失敗（試行" + attempt + "）", err);
      await sleep(600);
    }
  }
  return { ok: false, status: map };
}

// ---------- マスタ参照 ----------

function buildingsOfBase() {
  return MASTERS.buildings.filter((b) => b.base === state.base);
}

function positionsOf(b) {
  return b && b.splitPositions && b.splitPositions.length ? b.splitPositions : [""];
}

function positionsForCol(b, col) {
  return b && b.splitCols && b.splitCols.includes(col) ? positionsOf(b) : [""];
}

function findBuilding(base, name) {
  return MASTERS.buildings.find((b) => b.base === base && b.name === name);
}

// 記録の位置の値を現在の棟の区分に合わせて展開（昨日までの pos="" データも分割列に出す）
function expandPositions(b, col, pos) {
  const poss = positionsForCol(b, Number(col));
  return poss.indexOf(pos) >= 0 ? [pos] : poss;
}

function isFree(b) {
  return !!(b && b.type === "free");
}

// 絞り込みに使う作業一覧。棟限定の作業（出荷調整＝平川のみ）は選択中の棟のときだけ出す
function filterWorks() {
  const b = state.building;
  const list = [...MASTERS.works];
  ((b && b.extraWorks) || []).forEach((w) => {
    if (!list.includes(w)) {
      const idx = list.indexOf("その他");
      list.splice(idx < 0 ? list.length : idx, 0, w);
    }
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
  renderWorkFilter(); // 棟により選べる作業が変わる（出荷調整は平川のみ）
  refresh(); // 棟が変わったらデータを取り直す（列なし場所の履歴取得のため）
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

// 日別: 表示中の棟のマスごとに、その日やった作業と途中フラグ
function cellWorksMap() {
  const map = new Map();
  state.records
    .filter((r) => r.base === state.base && r.building === state.building.name)
    .forEach((r) => {
      if (r.row === "" || r.row === undefined) return;
      expandPositions(state.building, r.row, r.pos).forEach((pos) => {
        const key = r.row + "|" + pos;
        if (!map.has(key)) map.set(key, { works: new Set(), partial: false });
        const o = map.get(key);
        o.works.add(r.work);
        if (r.state === "途中") o.partial = true;
      });
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

  // 列のない場所（育苗ハウス等）は「作業でしぼる」を隠し、見出しも変える
  const free = isFree(b);
  $("grid-title").textContent = free ? "この場所の作業" : "配置図";
  const wfSec = $("work-filter-sec");
  if (wfSec) wfSec.hidden = free;

  if (free) {
    // 日別＝今日の「作業：実施者」、週間＝日付（何日前）ごとの「作業：実施者」
    if (state.mode === "day") {
      $("grid-hint").textContent = "今日の作業と実施者";
      const recs = state.records.filter((r) => r.base === state.base && r.building === b.name);
      if (recs.length === 0) {
        area.appendChild(el("div", "hint", "今日の記録はありません"));
        return;
      }
      const byWork = new Map();
      recs.forEach((r) => {
        const w = r.work === "その他" && r.workDetail ? `その他（${r.workDetail}）` : r.work;
        const label = w + (r.state === "途中" ? "（途中）" : "");
        if (!byWork.has(label)) byWork.set(label, new Set());
        byWork.get(label).add(r.recorder);
      });
      const box = el("div", "free-log");
      byWork.forEach((people, label) => {
        box.appendChild(el("div", "item", `${label}：${[...people].join("・")}`));
      });
      area.appendChild(box);
      return;
    }

    $("grid-hint").textContent = "直近30日（新しい順）";
    const hist = state.history || [];
    if (hist.length === 0) {
      area.appendChild(el("div", "hint", "直近30日の記録はありません"));
      return;
    }
    const today0 = new Date(formatDateStr(new Date()) + "T00:00:00");
    const byDate = new Map();
    hist.forEach((r) => {
      if (!byDate.has(r.date)) byDate.set(r.date, new Map());
      const w = r.work === "その他" && r.workDetail ? `その他（${r.workDetail}）` : r.work;
      const label = w + (r.state === "途中" ? "（途中）" : "");
      const m = byDate.get(r.date);
      if (!m.has(label)) m.set(label, new Set());
      m.get(label).add(r.recorder);
    });
    const box = el("div", "free-log");
    [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1)).forEach((date) => {
      const d = new Date(date + "T00:00:00");
      const ago = Math.round((today0 - d) / MS_DAY);
      const md = d.getMonth() + 1 + "/" + d.getDate();
      box.appendChild(el("div", "recorder-head", `${md}（${ago === 0 ? "今日" : ago + "日前"}）`));
      byDate.get(date).forEach((people, label) => {
        box.appendChild(el("div", "item", `${label}：${[...people].join("・")}`));
      });
    });
    area.appendChild(box);
    return;
  }

  $("grid-hint").textContent =
    state.mode === "day"
      ? "緑＝記録あり（文字はやった作業）"
      : "数字＝最後にやってから何日たったか（青＝最近 → 赤＝7日以上 or 記録なし）";

  const worksMap = state.mode === "day" ? cellWorksMap() : null;
  const wrap = el("div", "bar-grid");

  for (let col = 1; col <= b.cols; col++) {
    const row = el("div", "bar-row");
    row.appendChild(el("div", "bar-label", col + "列"));
    positionsForCol(b, col).forEach((pos) => {
      let cls = "bar-cell";
      let label = "";
      if (state.mode === "day") {
        const info = worksMap.get(col + "|" + pos);
        const show = info && (state.workFilter === null || info.works.has(state.workFilter));
        if (show) {
          cls += " filled";
          if (info.partial) cls += " partial";
        }
        label = info ? [...info.works].map(workAbbr).slice(0, 5).join("・") : "";
      } else {
        const heat = cellHeat(col, pos);
        cls += heat.cls;
        label = heat.label;
      }
      const cell = el("div", cls);
      if (pos) cell.appendChild(el("span", "cell-pos", pos));
      cell.appendChild(el("span", "cell-body", label));
      row.appendChild(cell);
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
      const baseWork = r.work === "その他" && r.workDetail ? `その他（${r.workDetail}）` : r.work;
      const work = baseWork + (r.state === "途中" ? "（途中）" : "");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
