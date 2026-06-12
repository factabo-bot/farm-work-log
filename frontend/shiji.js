"use strict";

// 指示作成画面（社長用）
// 作業を選ぶと配置図が「最後にその作業をしてから何日たったか」のヒートマップになる。
// 文面はLINEに直接送信（グループから開いた場合）または共有画面・コピペで投稿する。

const state = {
  staff: [],            // 宛先候補 {name, userId}
  staffSel: new Set(),  // 選択中の宛先（複数可・nameのSet）
  base: MASTERS.bases[0],
  building: null,
  work: null,           // 選択中の作業（単一）
  cells: new Set(),     // 選択中マス "列|位置"
  blocks: [],           // 宛先ごとの指示 {name, userId, note, tasks:[]}
  status: new Map(),    // "拠点|棟|列|位置|作業" → 最後にやった日
  liffReady: false,
  mock: !CONFIG.GAS_URL,
};

const $ = (id) => document.getElementById(id);
const MS_DAY = 24 * 60 * 60 * 1000;
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

init();

async function init() {
  if (CONFIG.LIFF_ID && typeof liff !== "undefined") {
    try {
      await liff.init({ liffId: CONFIG.LIFF_ID });
      state.liffReady = true;
    } catch (err) {
      console.warn("LIFF初期化に失敗（コピペ運用は可能）", err);
    }
  }

  renderBases();
  selectBuilding(buildingsOfBase()[0]);
  renderStaff();
  renderBlocks();

  $("manual-add-btn").addEventListener("click", () => {
    const name = $("manual-name").value.trim();
    if (!name) return;
    if (!state.staff.some((s) => s.name === name)) {
      state.staff.push({ name, userId: "" });
    }
    state.staffSel.add(name);
    $("manual-name").value = "";
    renderStaff();
  });
  $("add-task").addEventListener("click", addTask);
  $("preview-btn").addEventListener("click", showPreview);
  $("send-btn").addEventListener("click", sendToLine);
  $("copy-btn").addEventListener("click", copyPreview);
  $("save-btn").addEventListener("click", () => save(false));

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
    const res = await fetch(CONFIG.GAS_URL + "?action=status&days=30");
    const data = await res.json();
    Object.entries(data.status || {}).forEach(([k, v]) => state.status.set(k, v));
  } catch (err) {
    console.warn("作業状況の取得に失敗", err);
  }
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

// ---------- 描画 ----------

function renderStaff() {
  const box = $("staff-buttons");
  box.innerHTML = "";
  if (state.staff.length === 0) {
    box.appendChild(el("div", "hint", "（記録した人が自動で候補になります。下の欄から手入力でも追加できます）"));
    return;
  }
  state.staff.forEach((s) => {
    const btn = el("button", "btn" + (state.staffSel.has(s.name) ? " active" : ""), s.name);
    btn.addEventListener("click", () => {
      state.staffSel.has(s.name) ? state.staffSel.delete(s.name) : state.staffSel.add(s.name);
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
  state.work = null;
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

function renderWorkArea() {
  const box = $("work-buttons");
  box.innerHTML = "";
  const b = state.building;
  const detail = $("work-detail");

  buildingWorks(b).forEach((w) => {
    const btn = el("button", "btn" + (w === state.work ? " active" : ""), w);
    btn.addEventListener("click", () => {
      state.work = w === state.work ? null : w;
      if (!isFree(b)) detail.hidden = state.work !== "その他";
      renderWorkArea();
      renderGrid(); // 選んだ作業のヒートマップに切り替える
    });
    box.appendChild(btn);
  });

  if (isFree(b)) {
    detail.hidden = false;
    detail.placeholder = "依頼する作業を記入（例: トウモロコシ播種）";
  } else {
    detail.placeholder = "作業内容を記入";
  }
}

// 選択中の作業について、最後にやってからの日数 → 0〜6日とそれ以上の8段階
function cellHeat(col, pos) {
  if (
    !state.work ||
    state.work === "その他" ||
    (MASTERS.noPlaceWorks || []).includes(state.work)
  ) {
    return { cls: "", label: "" };
  }
  const key = [state.base, state.building.name, col, pos, state.work].join("|");
  const last = state.status.get(key);
  if (!last) return { cls: " age7", label: "" };
  const days = Math.round(
    (new Date(formatToday() + "T00:00:00") - new Date(last + "T00:00:00")) / MS_DAY
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
      const heat = cellHeat(col, pos);
      let cls = "bar-cell" + heat.cls;
      if (state.cells.has(key)) cls += " selected";
      const cell = el("button", cls, heat.label);
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

  // 左端に上から下まで通しの「入口」ブロック
  const outer = el("div", "bar-wrap");
  outer.appendChild(el("div", "entrance-block", "入口"));
  outer.appendChild(wrap);
  area.appendChild(outer);
}

function renderBlocks() {
  const box = $("block-list");
  box.innerHTML = "";
  state.blocks.forEach((block, bi) => {
    const card = el("div", "block-card");

    const head = el("div", "block-head");
    head.appendChild(el("span", "", block.names.map((n) => "@" + n).join(" ")));
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
  if (state.staffSel.size === 0) {
    toast("宛先を選んでください");
    return;
  }
  const b = state.building;
  const detail = $("work-detail").value.trim();
  let work = state.work;
  let workDetail = "";

  if (isFree(b)) {
    if (!work && detail) work = detail;
    if (!work) {
      toast("作業を選ぶか記入してください");
      return;
    }
  } else {
    if (!work) {
      toast("作業を選んでください");
      return;
    }
    if (work === "その他") {
      if (!detail) {
        toast("「その他」の作業内容を記入してください");
        return;
      }
      workDetail = detail;
    }
  }

  const cells = isFree(b)
    ? []
    : [...state.cells].map((key) => {
        const [row, pos] = key.split("|");
        return { row: Number(row), pos };
      });

  const task = { base: state.base, building: b.name, work, workDetail, cells };

  // 選んだ宛先の組み合わせで1ブロックにまとめる（備考も共通で1つ）
  const names = [...state.staffSel].sort();
  const key = names.join("、");
  let block = state.blocks.find((x) => x.key === key);
  if (!block) {
    block = { key, names, note: "", tasks: [] };
    state.blocks.push(block);
  }
  block.tasks.push(task);

  state.cells.clear();
  state.work = null;
  $("work-detail").value = "";
  renderWorkArea();
  renderGrid();
  renderBlocks();
  toast("指示リストに追加しました");
}

function taskText(t) {
  const b = MASTERS.buildings.find((x) => x.base === t.base && x.name === t.building);
  const loc = t.base === "平川" && t.building === "ハウス" ? "平川" : t.base + t.building;
  const work = t.work === "その他" ? t.workDetail : t.work;
  const place = t.cells.length > 0 ? "（" + summarizeCells(t.cells, positionsOf(b)) + "）" : "";
  return loc + " " + work + place;
}

function buildMessage() {
  const lines = [];
  const comment = $("comment").value.trim();
  if (comment) {
    lines.push(comment, "");
  }
  state.blocks.forEach((block) => {
    lines.push(block.names.map((n) => "@" + n).join(" "));
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
  $("send-btn").hidden = false;
  $("copy-btn").hidden = false;
  $("save-btn").hidden = false;
}

// LINEへワンボタン送信。
// グループ・トークから開いた場合は本人名義でそのトークへ直接投稿、
// それ以外では送信先を選ぶLINEの共有画面を出す。送信成功時はシートにも自動保存する。
async function sendToLine() {
  if (state.blocks.length === 0) {
    toast("指示リストが空です");
    return;
  }
  const text = buildMessage();
  if (!state.liffReady) {
    toast("LINE連携が使えない開き方です。「文面をコピー」で貼り付けてください");
    return;
  }
  // まずは「開いているトークへ直接投稿」を試し、ダメなら送信先を選ぶ共有画面に切り替える
  if (liff.isInClient()) {
    const ctx = liff.getContext();
    if (ctx && ["group", "room", "utou"].includes(ctx.type)) {
      try {
        await liff.sendMessages([{ type: "text", text }]);
        toast("✅ このトークに送信しました");
        save(true);
        return;
      } catch (err) {
        console.warn("sendMessages失敗。共有画面に切り替えます", err);
      }
    }
  }
  try {
    if (liff.isApiAvailable && liff.isApiAvailable("shareTargetPicker")) {
      const res = await liff.shareTargetPicker([{ type: "text", text }]);
      if (res) {
        toast("✅ 送信しました");
        save(true);
      } else {
        toast("送信をキャンセルしました");
      }
      return;
    }
    toast("直接送信には権限の許可が必要です。LIFFを開き直して同意するか、「文面をコピー」で貼り付けてください");
  } catch (err) {
    console.error(err);
    const msg = (err && (err.message || err.code)) || "不明なエラー";
    toast(`⚠ 送信できませんでした（${msg}）。「文面をコピー」をお使いください`);
  }
}

async function copyPreview() {
  try {
    await navigator.clipboard.writeText(buildMessage());
    toast("コピーしました。LINEグループに貼り付けてください");
  } catch (err) {
    toast("コピーに失敗しました。文面を長押しで選択してください");
  }
}

async function save(silent) {
  const payload = {
    type: "shiji",
    date: formatToday(),
    comment: $("comment").value.trim(),
    // タスクシートには宛先1人ずつに展開して保存する
    blocks: state.blocks.flatMap((b) =>
      b.names.map((name) => {
        const s = state.staff.find((x) => x.name === name);
        return {
          name,
          userId: (s && s.userId) || "",
          note: b.note.trim(),
          tasks: b.tasks.map((t) => {
            const bld = MASTERS.buildings.find((x) => x.base === t.base && x.name === t.building);
            return {
              base: t.base,
              building: t.building,
              work: t.work,
              workDetail: t.workDetail,
              place: t.cells.length > 0 ? summarizeCells(t.cells, positionsOf(bld)) : "",
              cells: t.cells,
            };
          }),
        };
      })
    ),
  };
  if (state.mock) {
    if (!silent) toast("お試しモードのため保存先がありません");
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
    if (!silent) toast(`✅ 保存しました（${data.saved}件）`);
  } catch (err) {
    console.error(err);
    toast("⚠ シートへの保存に失敗しました");
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

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}
