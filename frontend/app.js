"use strict";

// 状態
const state = {
  base: null,          // 選択中の拠点名
  building: null,      // 選択中の棟オブジェクト（MASTERS.buildingsの要素）
  cells: new Set(),    // 選択中マス "列|位置" 例 "3|奥"
  works: new Set(),    // 選択中の作業名（複数可）
  items: [],           // 追加済みの作業 [{base, building, cells:[{row,pos}], works:[], workDetail}]
  todayWorks: new Map(),// 今日記録済みのマス "拠点|棟|列|位置" → 作業名のSet
  profile: { userId: "", displayName: "テスト利用者" },
  mock: !CONFIG.GAS_URL,
};

const $ = (id) => document.getElementById(id);

init();

async function init() {
  $("date-display").textContent = formatToday() + " の記録";

  // LINE内で開かれた場合は本人情報を取得（未設定ならお試しモード）
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
      // LINE外のブラウザで未ログインの場合は、強制ログインせず「テスト利用者」のまま動かす
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
  renderWorks();
  renderItems();

  await loadToday();
  renderGrid();

  $("add-item").addEventListener("click", () => {
    if (addCurrentItem()) toast("リストに追加しました。続けて選んでください");
  });
  $("submit").addEventListener("click", submitAll);
}

// ---------- 描画 ----------

function buildingsOfBase() {
  return MASTERS.buildings.filter((b) => b.base === state.base);
}

// 位置区分（奥/手前）は廃止したが、マスタに定義があれば従う（互換用）
function positionsOf(b) {
  return b.positions && b.positions.length ? b.positions : [""];
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
  state.cells.clear();
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

// 配置図: 入口から見た向きで表示する。
// 列が左右に並び、上＝奥・下＝手前。通路は列の間の細い帯。下中央に入口マーク。
// 16列の棟は横スクロールで全体を見る
function renderGrid() {
  const area = $("grid-area");
  area.innerHTML = "";
  const b = state.building;
  if (!b) return;

  const positions = positionsOf(b);
  const hasLabels = positions.some((p) => p);
  const flex = el("div", "grid-flex");

  // 左端: 行ラベル（位置区分がある場合のみ）
  if (hasLabels) {
    const labelCol = el("div", "grid-col label-col");
    labelCol.appendChild(el("div", "col-num", ""));
    positions.forEach((pos) => labelCol.appendChild(el("div", "row-label", pos)));
    flex.appendChild(labelCol);
  }

  for (let col = 1; col <= b.cols; col++) {
    const colDiv = el("div", "grid-col");
    colDiv.appendChild(el("div", "col-num", String(col)));
    positions.forEach((pos) => {
      const key = col + "|" + pos;
      const doneKey = [state.base, b.name, col, pos].join("|");
      const doneWorks = state.todayWorks.get(doneKey);
      let cls = "cell";
      if (doneWorks) cls += " done";
      if (state.cells.has(key)) cls += " selected";
      // 記録済みマスには作業の頭文字（収・誘・葉…）を縦に表示
      const label = doneWorks ? [...doneWorks].map(workAbbr).slice(0, 4).join("\n") : "";
      const cell = el("button", cls, label);
      cell.addEventListener("click", () => {
        state.cells.has(key) ? state.cells.delete(key) : state.cells.add(key);
        renderGrid();
      });
      colDiv.appendChild(cell);
    });
    flex.appendChild(colDiv);

    // 通路（両端は1列・それ以外は2列ごと）
    if ((b.aisleAfter || []).includes(col) && col < b.cols) {
      flex.appendChild(el("div", "aisle-v", ""));
    }
  }
  // 図と入口マークを同じ幅の箱に入れる（横スクロール時も図の中央に入口が来る）
  const inner = el("div", "grid-inner" + (hasLabels ? "" : " no-labels"));
  inner.appendChild(flex);
  inner.appendChild(el("div", "entrance", "▲ 入口（妻面中央）"));
  area.appendChild(inner);
}

function renderWorks() {
  const box = $("work-buttons");
  box.innerHTML = "";
  MASTERS.works.forEach((w) => {
    const btn = el("button", "btn" + (state.works.has(w) ? " active" : ""), w);
    btn.addEventListener("click", () => {
      state.works.has(w) ? state.works.delete(w) : state.works.add(w);
      $("work-detail").hidden = !state.works.has("その他");
      renderWorks();
    });
    box.appendChild(btn);
  });
}

function renderItems() {
  const box = $("item-list");
  box.innerHTML = "";
  state.items.forEach((item, i) => {
    const row = el("div", "item");
    const cellsText = summarizeCells(item.cells);
    const worksText = item.works
      .map((w) => (w === "その他" ? `その他（${item.workDetail}）` : w))
      .join("・");
    row.appendChild(el("span", "", `${item.building} ${cellsText} / ${worksText}`));
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

// 現在の選択（棟・作業・マス）を作業リストに1件追加する
function addCurrentItem() {
  if (state.works.size === 0) {
    toast("作業を選んでください");
    return false;
  }
  if (!state.building || state.cells.size === 0) {
    toast("場所をタップで選んでください");
    return false;
  }
  const detail = $("work-detail").value.trim();
  if (state.works.has("その他") && !detail) {
    toast("「その他」の作業内容を記入してください");
    return false;
  }
  const cells = [...state.cells].map((key) => {
    const [row, pos] = key.split("|");
    return { row: Number(row), pos };
  });
  state.items.push({
    base: state.base,
    building: state.building.name,
    cells,
    works: [...state.works],
    workDetail: state.works.has("その他") ? detail : "",
  });
  state.cells.clear();
  state.works.clear();
  $("work-detail").value = "";
  $("work-detail").hidden = true;
  renderGrid();
  renderWorks();
  renderItems();
  return true;
}

async function submitAll() {
  // 選択しかけのものがあればリストに入れてから送信
  if (state.cells.size > 0 || state.works.size > 0) {
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
      // "拠点|棟|列|位置|作業"
      data.done.forEach((s) => {
        const p = s.split("|");
        add(p.slice(0, 4).join("|"), p[4]);
      });
    } else {
      // 旧バージョンのGAS（作業名なし）へのフォールバック
      (data.keys || []).forEach((k) => add(k, null));
    }
  } catch (err) {
    console.warn("今日の記録の取得に失敗", err);
  }
}

// 作業名を1文字の略号にする（マス内表示用）
function workAbbr(w) {
  return w === "その他" ? "他" : w.charAt(0);
}

// お試しモード: ブラウザのlocalStorageに保存（端末内のみ・お試し用）
const MOCK_KEY = "farmlog_records";

function mockSave(payload) {
  const all = JSON.parse(localStorage.getItem(MOCK_KEY) || "[]");
  let saved = 0;
  payload.entries.forEach((en) => {
    en.cells.forEach((c) => {
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
      return pos ? `${ranges.join(",")}列(${pos})` : `${ranges.join(",")}列`;
    })
    .join(" ");
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}
