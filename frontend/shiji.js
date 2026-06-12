"use strict";

// 指示作成画面（社長用）
// 作業を選ぶと配置図が「最後にその作業をしてから何日たったか」のヒートマップになる

const state = {
  staff: [],          // 宛先候補 {name, userId}
  staffSel: null,     // 選択中の宛先
  base: MASTERS.bases[0],
  building: null,     // 選択中の棟オブジェクト
  work: null,         // 選択中の作業（単一）
  cells: new Set(),   // 選択中マス "列|位置"
  blocks: [],         // 宛先ごとの指示 {name, userId, note, tasks:[{base,building,work,workDetail,cells:[]}]}
  status: new Map(),  // "拠点|棟|列|位置|作業" → 最後にやった日 "yyyy-MM-dd"
  mock: !CONFIG.GAS_URL,
};

const $ = (id) => document.getElementById(id);
const MS_DAY = 24 * 60 * 60 * 1000;
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

init();

async function init() {
  renderBases();
  selectBuilding(buildingsOfBase()[0]);
  renderWorks();
  renderStaff();
  renderBlocks();

  $("manual-add-btn").addEventListener("click", () => {
    const name = $("manual-name").value.trim();
    if (!name) return;
    if (!state.staff.some((s) => s.name === name)) {
      state.staff.push({ name, userId: "" });
    }
    state.staffSel = state.staff.find((s) => s.name === name);
    $("manual-name").value = "";
    renderStaff();
  });
  $("add-task").addEventListener("click", addTask);
  $("preview-btn").addEventListener("click", showPreview);
  $("copy-btn").addEventListener("click", copyPreview);
  $("save-btn").addEventListener("click", save);

  await loadStaff();
  renderStaff();
  await loadStatus();
  renderGrid();
}

// ---------- データ取得 ----------

async function loadStaff() {
  if (state.mock) return;
  try {
    const res = await fetch(CONFIG.GAS_URL + "?action=staff");
    const data = await res.json();
    (data.staff || []).forEach((s) => {
      if (!state.staff.some((x) => x.name === s.name)) state.staff.push(s);
    });
  } catch (err) {
    console.warn("スタッフ一覧の取得に失敗", err);
  }
}

async function loadStatus() {
  state.status = new Map();
  if (state.mock) {
    const all = JSON.parse(localStorage.getItem("farmlog_records") || "[]");
    all.forEach((r) => {
      const key = [r.base, r.building, r.row, r.pos, r.work].join("|");
      const cur = state.status.get(key);
      if (!cur || cur < r.date) state.status.set(key, r.date);
    });
    return;
  }
  try {
    const res = await fetch(CONFIG.GAS_URL + "?action=status&days=14");
    const data = await res.json();
    Object.entries(data.status || {}).forEach(([k, v]) => state.status.set(k, v));
  } catch (err) {
    console.warn("作業状況の取得に失敗", err);
  }
}

// ---------- 描画 ----------

function buildingsOfBase() {
  return MASTERS.buildings.filter((b) => b.base === state.base);
}

// 位置区分（奥/手前）は廃止したが、マスタに定義があれば従う（互換用）
function positionsOf(b) {
  return b.positions && b.positions.length ? b.positions : [""];
}

function renderStaff() {
  const box = $("staff-buttons");
  box.innerHTML = "";
  if (state.staff.length === 0) {
    box.appendChild(el("div", "hint", "（記録した人が自動で候補になります。下の欄から手入力でも追加できます）"));
    return;
  }
  state.staff.forEach((s) => {
    const btn = el("button", "btn" + (state.staffSel === s ? " active" : ""), s.name);
    btn.addEventListener("click", () => {
      state.staffSel = state.staffSel === s ? null : s;
      renderStaff();
    });
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

function renderWorks() {
  const box = $("work-buttons");
  box.innerHTML = "";
  MASTERS.works.forEach((w) => {
    const btn = el("button", "btn" + (w === state.work ? " active" : ""), w);
    btn.addEventListener("click", () => {
      state.work = w === state.work ? null : w;
      $("work-detail").hidden = state.work !== "その他";
      renderWorks();
      renderGrid(); // 選んだ作業のヒートマップに切り替える
    });
    box.appendChild(btn);
  });
}

// マスの色と表示（選択中の作業について、最後にやってから何日か）
function cellHeat(col, pos) {
  if (!state.work || state.work === "その他") return { cls: "", label: "" };
  const key = [state.base, state.building.name, col, pos, state.work].join("|");
  const last = state.status.get(key);
  if (!last) return { cls: " age3", label: "" }; // 直近2週間に記録なし＝要注意扱い
  const days = Math.round(
    (new Date(formatToday() + "T00:00:00") - new Date(last + "T00:00:00")) / MS_DAY
  );
  const cls = days <= 2 ? " age0" : days <= 4 ? " age1" : days <= 6 ? " age2" : " age3";
  return { cls, label: String(days) };
}

function renderGrid() {
  const area = $("grid-area");
  area.innerHTML = "";
  const b = state.building;
  if (!b) return;

  const positions = positionsOf(b);
  const hasLabels = positions.some((p) => p);
  const flex = el("div", "grid-flex");
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
      const heat = cellHeat(col, pos);
      let cls = "cell" + heat.cls;
      if (state.cells.has(key)) cls += " selected";
      const cell = el("button", cls, heat.label);
      cell.addEventListener("click", () => {
        state.cells.has(key) ? state.cells.delete(key) : state.cells.add(key);
        renderGrid();
      });
      colDiv.appendChild(cell);
    });
    flex.appendChild(colDiv);
    if ((b.aisleAfter || []).includes(col) && col < b.cols) {
      flex.appendChild(el("div", "aisle-v", ""));
    }
  }

  const inner = el("div", "grid-inner" + (hasLabels ? "" : " no-labels"));
  inner.appendChild(flex);
  inner.appendChild(el("div", "entrance", "▲ 入口（妻面中央）"));
  area.appendChild(inner);
}

function renderBlocks() {
  const box = $("block-list");
  box.innerHTML = "";
  state.blocks.forEach((block, bi) => {
    const card = el("div", "block-card");

    const head = el("div", "block-head");
    head.appendChild(el("span", "", "@" + block.name));
    const delBlock = el("button", "del", "削除");
    delBlock.addEventListener("click", () => {
      state.blocks.splice(bi, 1);
      renderBlocks();
    });
    head.appendChild(delBlock);
    card.appendChild(head);

    block.tasks.forEach((t, ti) => {
      const line = el("div", "task-line");
      line.appendChild(el("span", "", (CIRCLED[ti] || ti + 1 + ".") + " " + taskText(t)));
      const delTask = el("button", "del", "削除");
      delTask.addEventListener("click", () => {
        block.tasks.splice(ti, 1);
        if (block.tasks.length === 0) state.blocks.splice(bi, 1);
        renderBlocks();
      });
      line.appendChild(delTask);
      card.appendChild(line);
    });

    const note = document.createElement("textarea");
    note.placeholder = "この人への備考（例: 4時間でできるところまで）";
    note.value = block.note;
    note.addEventListener("input", () => (block.note = note.value));
    card.appendChild(note);

    box.appendChild(card);
  });
}

// ---------- 操作 ----------

function addTask() {
  if (!state.staffSel) {
    toast("宛先を選んでください");
    return;
  }
  if (!state.work) {
    toast("作業を選んでください");
    return;
  }
  const detail = $("work-detail").value.trim();
  if (state.work === "その他" && !detail) {
    toast("「その他」の作業内容を記入してください");
    return;
  }
  const cells = [...state.cells].map((key) => {
    const [row, pos] = key.split("|");
    return { row: Number(row), pos };
  });

  let block = state.blocks.find((b) => b.name === state.staffSel.name);
  if (!block) {
    block = { name: state.staffSel.name, userId: state.staffSel.userId || "", note: "", tasks: [] };
    state.blocks.push(block);
  }
  block.tasks.push({
    base: state.base,
    building: state.building.name,
    work: state.work,
    workDetail: state.work === "その他" ? detail : "",
    cells,
  });

  state.cells.clear();
  state.work = null;
  $("work-detail").value = "";
  $("work-detail").hidden = true;
  renderWorks();
  renderGrid();
  renderBlocks();
  toast("指示リストに追加しました");
}

function taskText(t) {
  const loc = t.base === "平川" ? "平川" : t.base + t.building;
  const work = t.work === "その他" ? t.workDetail : t.work;
  const place = t.cells.length > 0 ? "（" + summarizeCells(t.cells) + "）" : "";
  return loc + " " + work + place;
}

function buildMessage() {
  const lines = [];
  const comment = $("comment").value.trim();
  if (comment) {
    lines.push(comment, "");
  }
  state.blocks.forEach((block) => {
    lines.push("@" + block.name);
    block.tasks.forEach((t, i) => {
      lines.push((CIRCLED[i] || i + 1 + ".") + " " + taskText(t));
    });
    if (block.note.trim()) lines.push("備考: " + block.note.trim());
    lines.push("");
  });
  return lines.join("\n").trim();
}

function showPreview() {
  if (state.blocks.length === 0) {
    toast("指示リストが空です");
    return;
  }
  $("preview").textContent = buildMessage();
  $("preview").hidden = false;
  $("copy-btn").hidden = false;
  $("save-btn").hidden = false;
}

async function copyPreview() {
  try {
    await navigator.clipboard.writeText(buildMessage());
    toast("コピーしました。LINEグループに貼り付けてください");
  } catch (err) {
    toast("コピーに失敗しました。文面を長押しで選択してください");
  }
}

async function save() {
  const payload = {
    type: "shiji",
    date: formatToday(),
    comment: $("comment").value.trim(),
    blocks: state.blocks.map((b) => ({
      name: b.name,
      userId: b.userId,
      note: b.note.trim(),
      tasks: b.tasks.map((t) => ({
        base: t.base,
        building: t.building,
        work: t.work,
        workDetail: t.workDetail,
        place: t.cells.length > 0 ? summarizeCells(t.cells) : "",
        cells: t.cells,
      })),
    })),
  };
  if (state.mock) {
    toast("お試しモードのため保存先がありません");
    return;
  }
  $("save-btn").disabled = true;
  try {
    const res = await fetch(CONFIG.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "GAS error");
    toast(`✅ 保存しました（${data.saved}件）`);
  } catch (err) {
    console.error(err);
    toast("⚠ 保存に失敗しました。もう一度お試しください");
  } finally {
    $("save-btn").disabled = false;
  }
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
