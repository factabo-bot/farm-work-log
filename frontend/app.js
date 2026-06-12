"use strict";

// 状態
const state = {
  base: null,          // 選択中の拠点名
  building: null,      // 選択中の棟オブジェクト
  cells: new Set(),    // 選択中マス "列|位置" 例 "3|入口側"
  works: new Set(),    // 選択中の作業（複数可）
  items: [],           // 追加済みの作業 [{base, building, cells:[], works:[], workDetail}]
  todayWorks: new Map(),// 今日記録済みのマス "拠点|棟|列|位置" → 作業名のSet
  profile: { userId: "", displayName: "テスト利用者" },
  mock: !CONFIG.GAS_URL,
};

const $ = (id) => document.getElementById(id);

init();

async function init() {
  $("date-display").textContent = formatToday() + " の記録";

  // LINE内で開かれた場合は本人情報を取得
  if (CONFIG.LIFF_ID && typeof liff !== "undefined") {
    try {
      await liff.init({ liffId: CONFIG.LIFF_ID });
      if (liff.isLoggedIn()) {
        const p = await liff.getProfile();
        state.profile = { userId: p.userId, displayName: p.displayName };
      } else if (liff.isInClient()) {
        liff.login();
        return;
      }
      // LINE外のブラウザで未ログインの場合は「テスト利用者」のまま動かす
    } catch (err) {
      console.warn("LIFF初期化に失敗。テスト利用者として続行します", err);
    }
  }
  const suffix = state.mock
    ? "（お試しモード）"
    : state.profile.userId ? "" : "（LINE外）";
  $("user-info").textContent = state.profile.displayName + suffix;

  state.base = MASTERS.bases[0];
  renderBases();
  selectBuilding(buildingsOfBase()[0]);
  renderItems();

  await loadToday();
  renderGrid();

  $("add-item").addEventListener("click", () => {
    if (addCurrentItem()) {
      toast("リストに追加しました。続けて選んでください");
      window.scrollTo({ top: 0, behavior: "smooth" }); // 次の選択のため先頭に戻る
    }
  });
  $("submit").addEventListener("click", submitAll);
}

// ---------- マスタ参照 ----------

function buildingsOfBase() {
  return MASTERS.buildings.filter((b) => b.base === state.base);
}

function findBuilding(base, name) {
  return MASTERS.buildings.find((b) => b.base === base && b.name === name);
}

function positionsOf(b) {
  return b && b.positions && b.positions.length ? b.positions : [""];
}

function isFree(b) {
  return !!(b && b.type === "free");
}

// その棟で選べる作業一覧（extraWorksは「その他」の手前に入る）
function buildingWorks(b) {
  if (isFree(b)) return b.quickWorks || [];
  const list = [...MASTERS.works];
  (b.extraWorks || []).forEach((w) => {
    if (!list.includes(w)) {
      const idx = list.indexOf("その他");
      list.splice(idx < 0 ? list.length : idx, 0, w);
    }
  });
  return list;
}

// 場所（列）の指定が要らない作業か
function isNoPlace(w) {
  return (MASTERS.noPlaceWorks || []).includes(w);
}

// ---------- 描画 ----------

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
  state.cells.clear();
  state.works.clear();
  $("work-detail").value = "";
  renderBuildings();
  renderWorkArea();
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

// 作業の選択欄。トマトハウスは共通の作業ボタン、フリー記録場所はよく使う作業＋自由記入
function renderWorkArea() {
  const box = $("work-buttons");
  box.innerHTML = "";
  const b = state.building;
  const detail = $("work-detail");

  if (isFree(b)) {
    buildingWorks(b).forEach((w) => appendWorkChip(box, w));
    detail.hidden = false;
    detail.placeholder = "やった作業を記入（例: トウモロコシ播種）";
    return;
  }

  buildingWorks(b).forEach((w) => appendWorkChip(box, w));
  detail.hidden = !state.works.has("その他");
  detail.placeholder = "やった作業を記入";
}

function appendWorkChip(box, w) {
  const btn = el("button", "btn" + (state.works.has(w) ? " active" : ""), w);
  btn.addEventListener("click", () => {
    state.works.has(w) ? state.works.delete(w) : state.works.add(w);
    if (!isFree(state.building)) {
      $("work-detail").hidden = !state.works.has("その他");
    }
    renderWorkArea();
  });
  box.appendChild(btn);
}

// 配置図: 入口（妻面中央）を左にして、列を横長バーで縦に並べる。
// バーは「入口側半分／奥側半分」に分かれ、列番号タップで列全体を選択
function renderGrid() {
  const area = $("grid-area");
  area.innerHTML = "";
  const b = state.building;
  if (!b) return;

  if (isFree(b)) {
    area.appendChild(el("div", "hint", "この場所は列の指定はありません。作業を選んで（または記入して）そのまま追加してください"));
    return;
  }

  // 一括選択（中央通路がある棟は左右半分も選べる）
  const positions = positionsOf(b);
  const selectRange = (from, to) => {
    for (let col = from; col <= to; col++) {
      positions.forEach((pos) => state.cells.add(col + "|" + pos));
    }
    renderGrid();
  };
  const bulk = el("div", "btn-row bulk-row");
  if (b.centerAfter) {
    const left = el("button", "btn", `左半分（1〜${b.centerAfter}列）`);
    left.addEventListener("click", () => selectRange(1, b.centerAfter));
    const right = el("button", "btn", `右半分（${b.centerAfter + 1}〜${b.cols}列）`);
    right.addEventListener("click", () => selectRange(b.centerAfter + 1, b.cols));
    bulk.appendChild(left);
    bulk.appendChild(right);
  }
  const allBtn = el("button", "btn", "すべて選択");
  allBtn.addEventListener("click", () => selectRange(1, b.cols));
  const clearBtn = el("button", "btn", "選択を解除");
  clearBtn.addEventListener("click", () => {
    state.cells.clear();
    renderGrid();
  });
  bulk.appendChild(allBtn);
  bulk.appendChild(clearBtn);
  area.appendChild(bulk);

  const wrap = el("div", "bar-grid");

  for (let col = 1; col <= b.cols; col++) {
    const row = el("div", "bar-row");

    const lbl = el("button", "bar-label", col + "列");
    lbl.addEventListener("click", () => {
      const keys = positions.map((pos) => col + "|" + pos);
      const allSelected = keys.every((k) => state.cells.has(k));
      keys.forEach((k) => (allSelected ? state.cells.delete(k) : state.cells.add(k)));
      renderGrid();
    });
    row.appendChild(lbl);

    positions.forEach((pos) => {
      const key = col + "|" + pos;
      const doneKey = [state.base, b.name, col, pos].join("|");
      const doneWorks = state.todayWorks.get(doneKey);
      let cls = "bar-cell";
      if (doneWorks) cls += " done";
      if (state.cells.has(key)) cls += " selected";
      const label = doneWorks ? [...doneWorks].map(workAbbr).slice(0, 5).join("・") : "";
      const cell = el("button", cls, label);
      cell.addEventListener("click", () => {
        state.cells.has(key) ? state.cells.delete(key) : state.cells.add(key);
        renderGrid();
      });
      row.appendChild(cell);
    });
    wrap.appendChild(row);

    if (b.centerAfter === col && col < b.cols) {
      wrap.appendChild(el("div", "center-aisle", "柱・中央通路"));
    } else if ((b.aisleAfter || []).includes(col) && col < b.cols) {
      wrap.appendChild(el("div", "aisle-h", ""));
    }
  }

  // 左端に上から下まで通しの「入口」ブロック（入口＝妻面中央が左にあることを表す）
  const outer = el("div", "bar-wrap");
  outer.appendChild(el("div", "entrance-block", "入口"));
  outer.appendChild(wrap);
  area.appendChild(outer);
}

function renderItems() {
  const box = $("item-list");
  box.innerHTML = "";
  state.items.forEach((item, i) => {
    const row = el("div", "item");
    const b = findBuilding(item.base, item.building);
    const place = item.cells.length > 0 ? " " + summarizeCells(item.cells, positionsOf(b)) : "";
    const worksText = item.works
      .map((w) => (w === "その他" && item.workDetail ? `その他（${item.workDetail}）` : w))
      .join("・");
    row.appendChild(el("span", "", `${item.building}${place} / ${worksText}`));
    const del = el("button", "del", "削除");
    del.addEventListener("click", () => {
      state.items.splice(i, 1);
      renderItems();
    });
    row.appendChild(del);
    box.appendChild(row);
  });
}

// ---------- 操作 ----------

function addCurrentItem() {
  const b = state.building;
  if (!b) return false;
  const detail = $("work-detail").value.trim();
  let works = [...state.works];

  if (isFree(b)) {
    if (detail) works.push(detail);
    if (works.length === 0) {
      toast("作業を選ぶか記入してください");
      return false;
    }
  } else {
    if (works.length === 0) {
      toast("作業を選んでください");
      return false;
    }
    if (state.works.has("その他") && !detail) {
      toast("「その他」の作業内容を記入してください");
      return false;
    }
    // 出荷調整など場所指定が不要な作業だけなら、列を選ばなくてもよい
    const needPlace = works.some((w) => !isNoPlace(w));
    if (needPlace && state.cells.size === 0) {
      toast("場所をタップで選んでください");
      return false;
    }
  }

  const cells = isFree(b)
    ? []
    : [...state.cells].map((key) => {
        const [row, pos] = key.split("|");
        return { row: Number(row), pos };
      });

  state.items.push({
    base: state.base,
    building: b.name,
    cells,
    works,
    workDetail: !isFree(b) && state.works.has("その他") ? detail : "",
  });

  state.cells.clear();
  state.works.clear();
  $("work-detail").value = "";
  renderWorkArea();
  renderGrid();
  renderItems();
  return true;
}

async function submitAll() {
  // 選択しかけのものがあればリストに入れてから送信
  if (state.cells.size > 0 || state.works.size > 0 || $("work-detail").value.trim()) {
    if (!addCurrentItem()) return;
  }
  if (state.items.length === 0) {
    toast("記録する作業がありません");
    return;
  }

  const payload = {
    recorder: state.profile.displayName,
    userId: state.profile.userId,
    note: $("note").value.trim(),
    entries: state.items,
  };

  $("submit").disabled = true;
  try {
    const saved = state.mock ? mockSave(payload) : await gasSave(payload);
    toast(`✅ 記録しました（${saved}件）`);
    state.items = [];
    $("note").value = "";
    renderItems();
    await loadToday();
    renderGrid();
  } catch (err) {
    console.error(err);
    toast("⚠ 送信に失敗しました。電波の良い場所でもう一度お試しください");
  } finally {
    $("submit").disabled = false;
  }
}

// ---------- 保存先（GAS / お試しモード） ----------

async function gasSave(payload) {
  // Content-Type: text/plain にするとCORSのプリフライトが発生しない（GASの定石）
  const res = await fetch(CONFIG.GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "GAS error");
  return data.saved;
}

async function loadToday() {
  state.todayWorks = new Map();
  const add = (key, work) => {
    if (!state.todayWorks.has(key)) state.todayWorks.set(key, new Set());
    if (work) state.todayWorks.get(key).add(work);
  };
  if (state.mock) {
    mockTodayRecords().forEach((r) =>
      add([r.base, r.building, r.row, r.pos].join("|"), r.work)
    );
    return;
  }
  try {
    const res = await fetch(CONFIG.GAS_URL + "?action=today");
    const data = await res.json();
    if (data.done) {
      data.done.forEach((s) => {
        const p = s.split("|");
        add(p.slice(0, 4).join("|"), p[4]);
      });
    } else {
      (data.keys || []).forEach((k) => add(k, null));
    }
  } catch (err) {
    console.warn("今日の記録の取得に失敗", err);
  }
}

// お試しモード: ブラウザのlocalStorageに保存（端末内のみ・お試し用）
const MOCK_KEY = "farmlog_records";

function mockSave(payload) {
  const all = JSON.parse(localStorage.getItem(MOCK_KEY) || "[]");
  let saved = 0;
  payload.entries.forEach((en) => {
    const cellList = en.cells.length > 0 ? en.cells : [{ row: "", pos: "" }];
    cellList.forEach((c) => {
      en.works.forEach((w) => {
        all.push({
          date: formatToday(),
          recorder: payload.recorder,
          base: en.base,
          building: en.building,
          row: c.row,
          pos: c.pos,
          work: w,
          workDetail: w === "その他" ? en.workDetail : "",
          note: payload.note,
        });
        saved++;
      });
    });
  });
  localStorage.setItem(MOCK_KEY, JSON.stringify(all));
  return saved;
}

function mockTodayRecords() {
  const all = JSON.parse(localStorage.getItem(MOCK_KEY) || "[]");
  return all.filter((r) => r.date === formatToday());
}

// ---------- 小物 ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function formatToday() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function workAbbr(w) {
  return w === "その他" ? "他" : w.charAt(0);
}

// 連続したマス選択を短い表記にまとめる。
// 両方の半分がそろっている列は「3〜5列」、片方だけは「3〜5列(入口側)」
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
  allPositions.forEach((pos) => {
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

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}
