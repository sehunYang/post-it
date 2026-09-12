import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, push, set, update, remove, onValue, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------- 유틸 ---------- */
const $ = (id) => document.getElementById(id);
const MAX_LEN = 20000;

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 보안 컨텍스트가 아닐 때(file:// 등) 대비한 폴백
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function formatTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return "오늘 " + time;
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) + " " + time;
}

/* ---------- 테마 ---------- */
const THEME_KEY = "postit.theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#111210" : "#f7f7f4");
  localStorage.setItem(THEME_KEY, theme);
}

applyTheme(
  localStorage.getItem(THEME_KEY) ||
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);

$("theme-toggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

/* ---------- 설정 확인 ---------- */
if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
  $("unconfigured").hidden = false;
  throw new Error("js/firebase-config.js 가 비어 있습니다.");
}

/* ---------- Firebase ---------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

setPersistence(auth, browserLocalPersistence).catch(() => {});

const POPUP_FALLBACK = [
  "auth/popup-blocked",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment"
];

$("btn-signin").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/popup-closed-by-user") return;
    if (POPUP_FALLBACK.includes(err.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    console.error(err);
    toast("로그인 실패: " + (err.code || err.message));
  }
});

$("btn-signout").addEventListener("click", () => signOut(auth));

/* ---------- 상태 ---------- */
let uid = null;
let unsubscribe = null;
let notes = [];
let pinnedId = null;
let editingId = null;

/* 선택 상태 — 클릭 / Ctrl+클릭 / Shift+클릭 */
let orderedNotes = [];            // 지금 화면에 그려진 순서. Shift 범위 계산의 기준.
let selectedIds = new Set();
let anchorIndex = null;           // Shift 범위의 시작점

const input = $("input");
const btnSave = $("btn-save");
const btnCancelEdit = $("btn-cancel-edit");

onAuthStateChanged(auth, (user) => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  if (!user) {
    uid = null;
    notes = [];
    orderedNotes = [];
    pinnedId = null;
    clearSelection();
    $("gate").hidden = false;
    $("app").hidden = true;
    return;
  }

  uid = user.uid;
  $("gate").hidden = true;
  $("app").hidden = false;
  $("account-name").textContent = user.displayName || "내 계정";
  $("account-mail").textContent = user.email || "";
  if (user.photoURL) $("avatar").src = user.photoURL;

  unsubscribe = onValue(
    ref(db, "users/" + uid),
    (snap) => {
      const val = snap.val() || {};
      pinnedId = val.pinned || null;
      notes = Object.entries(val.notes || {})
        .map(([id, n]) => ({
          id,
          text: (n && n.text) || "",
          createdAt: (n && n.createdAt) || 0,
          updatedAt: (n && n.updatedAt) || 0
        }))
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      render();
    },
    (err) => {
      console.error(err);
      toast("읽기 실패: " + (err.code || err.message) + " — 보안 규칙을 확인하세요.");
    }
  );
});

/* ---------- 렌더 ---------- */
function makeButton(label, extraClass, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (extraClass) b.className = extraClass;
  // 버튼은 카드 선택과 상관없이 자기 일만 합니다.
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

function render() {
  const list = $("list");
  list.textContent = "";
  $("empty").hidden = notes.length > 0;

  // 다른 기기에서 지워진 글이 선택에 남아 있지 않도록 정리합니다.
  const alive = new Set(notes.map((n) => n.id));
  for (const id of [...selectedIds]) if (!alive.has(id)) selectedIds.delete(id);

  // 고정된 글을 목록 맨 위로
  const ordered = notes.slice().sort((a, b) => (b.id === pinnedId) - (a.id === pinnedId));
  orderedNotes = ordered;

  for (const [index, note] of ordered.entries()) {
    const isPinned = note.id === pinnedId;
    const li = document.createElement("li");
    li.className = "note" +
      (isPinned ? " is-pinned" : "") +
      (selectedIds.has(note.id) ? " is-selected" : "");
    li.dataset.id = note.id;

    // Shift+클릭 때 브라우저가 글자를 드래그 선택하는 것을 막습니다.
    li.addEventListener("mousedown", (e) => { if (e.shiftKey) e.preventDefault(); });
    li.addEventListener("click", (e) => handleNoteClick(e, index, note.id));

    const p = document.createElement("p");
    p.className = "note-text";
    p.textContent = note.text;
    li.appendChild(p);

    const foot = document.createElement("div");
    foot.className = "note-foot";

    if (isPinned) {
      const flag = document.createElement("span");
      flag.className = "pin-flag";
      flag.textContent = "위젯 표시 중";
      foot.appendChild(flag);
    }

    const time = document.createElement("span");
    time.className = "note-time";
    time.textContent = formatTime(note.updatedAt || note.createdAt);
    foot.appendChild(time);

    foot.appendChild(makeButton("복사", "primary", async () => {
      const ok = await copyText(note.text);
      toast(ok ? "클립보드에 복사했습니다." : "복사에 실패했습니다.");
    }));
    foot.appendChild(makeButton(isPinned ? "고정 해제" : "위젯에 고정", "", () => togglePin(note.id)));
    foot.appendChild(makeButton("수정", "", () => startEdit(note)));
    foot.appendChild(makeButton("삭제", "danger", () => removeNote(note)));

    li.appendChild(foot);
    list.appendChild(li);
  }

  updateSelectionBar();
}

/* ---------- 선택 (클릭 / Ctrl+클릭 / Shift+클릭) ---------- */

function handleNoteClick(event, index, id) {
  if (event.shiftKey && anchorIndex !== null) {
    // 기준점부터 지금 누른 곳까지 통째로
    const from = Math.min(anchorIndex, index);
    const to = Math.max(anchorIndex, index);
    selectedIds = new Set(orderedNotes.slice(from, to + 1).map((n) => n.id));
  } else if (event.ctrlKey || event.metaKey) {
    // 하나씩 더하고 빼기
    if (!selectedIds.delete(id)) selectedIds.add(id);
    anchorIndex = index;
  } else {
    // 그냥 클릭이면 하나만. 이미 그것 하나만 골라져 있으면 선택을 풉니다.
    const onlyThis = selectedIds.size === 1 && selectedIds.has(id);
    selectedIds = onlyThis ? new Set() : new Set([id]);
    anchorIndex = onlyThis ? null : index;
  }

  if (selectedIds.size > 0 && editingId) cancelEdit();
  paintSelection();
}

/** 목록을 다시 그리지 않고 선택 표시만 갱신합니다. */
function paintSelection() {
  for (const li of $("list").children) {
    li.classList.toggle("is-selected", selectedIds.has(li.dataset.id));
  }
  updateSelectionBar();
}

function updateSelectionBar() {
  const count = selectedIds.size;
  $("selection-bar").hidden = count === 0;
  if (count === 0) return;
  $("selection-count").textContent = `${count}개 선택`;
  $("btn-select-all").textContent =
    count === orderedNotes.length ? "선택 해제" : "전체 선택";
}

function clearSelection() {
  selectedIds = new Set();
  anchorIndex = null;
  paintSelection();
}

function selectAll() {
  selectedIds = new Set(orderedNotes.map((n) => n.id));
  anchorIndex = 0;
  paintSelection();
}

$("btn-clear-selection").addEventListener("click", clearSelection);
$("btn-delete-selected").addEventListener("click", removeSelected);
$("btn-select-all").addEventListener("click", () => {
  if (selectedIds.size === orderedNotes.length) clearSelection();
  else selectAll();
});

// 카드 바깥을 누르면 선택 해제
document.addEventListener("click", (e) => {
  if (selectedIds.size === 0) return;
  if (e.target.closest(".note, .selection-bar")) return;
  clearSelection();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selectedIds.size > 0) {
    clearSelection();
    return;
  }

  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (typing) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && orderedNotes.length > 0) {
    e.preventDefault();
    selectAll();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
    e.preventDefault();
    removeSelected();
  }
});

async function removeSelected() {
  const ids = [...selectedIds];
  if (!uid || ids.length === 0) return;
  if (!confirm(`${ids.length}개를 삭제할까요?\n\n되돌릴 수 없습니다.`)) return;

  // 고정된 글이 섞여 있으면 같은 쓰기에서 고정도 함께 해제합니다.
  const updates = {};
  for (const id of ids) updates[`notes/${id}`] = null;
  if (pinnedId && ids.includes(pinnedId)) updates.pinned = null;

  const btn = $("btn-delete-selected");
  btn.disabled = true;
  try {
    await update(ref(db, `users/${uid}`), updates);
    if (editingId && ids.includes(editingId)) cancelEdit();
    clearSelection();
    toast(`${ids.length}개를 삭제했습니다.`);
  } catch (err) {
    console.error(err);
    toast("삭제 실패: " + (err.code || err.message));
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 동작 ---------- */
function updateCounter() {
  $("counter").textContent = input.value.length + "자";
}

input.addEventListener("input", updateCounter);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    save();
  }
});

btnSave.addEventListener("click", save);
btnCancelEdit.addEventListener("click", cancelEdit);

async function save() {
  if (!uid) return;
  const text = input.value.trim();
  if (!text) { toast("내용을 입력해 주세요."); input.focus(); return; }
  if (text.length > MAX_LEN) { toast(MAX_LEN + "자까지 저장할 수 있습니다."); return; }

  btnSave.disabled = true;
  try {
    if (editingId) {
      await update(ref(db, "users/" + uid + "/notes/" + editingId), {
        text,
        updatedAt: serverTimestamp()
      });
      toast("수정했습니다.");
      cancelEdit();
    } else {
      const created = push(ref(db, "users/" + uid + "/notes"));
      await set(created, {
        text,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      // 첫 글이면 자동으로 위젯에 고정
      if (!pinnedId) await set(ref(db, "users/" + uid + "/pinned"), created.key);
      input.value = "";
      updateCounter();
      toast("저장했습니다.");
    }
  } catch (err) {
    console.error(err);
    toast("저장 실패: " + (err.code || err.message));
  } finally {
    btnSave.disabled = false;
  }
}

function startEdit(note) {
  editingId = note.id;
  input.value = note.text;
  updateCounter();
  btnSave.textContent = "수정 저장";
  btnCancelEdit.hidden = false;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEdit() {
  editingId = null;
  input.value = "";
  updateCounter();
  btnSave.textContent = "저장";
  btnCancelEdit.hidden = true;
}

async function togglePin(id) {
  const willUnpin = pinnedId === id;
  try {
    await set(ref(db, "users/" + uid + "/pinned"), willUnpin ? null : id);
    toast(willUnpin ? "고정을 해제했습니다." : "위젯에 고정했습니다.");
  } catch (err) {
    console.error(err);
    toast("실패: " + (err.code || err.message));
  }
}

async function removeNote(note) {
  const preview = note.text.length > 24 ? note.text.slice(0, 24) + "…" : note.text;
  if (!confirm('삭제할까요?\n\n"' + preview + '"')) return;
  try {
    await remove(ref(db, "users/" + uid + "/notes/" + note.id));
    if (pinnedId === note.id) await set(ref(db, "users/" + uid + "/pinned"), null);
    if (editingId === note.id) cancelEdit();
    toast("삭제했습니다.");
  } catch (err) {
    console.error(err);
    toast("삭제 실패: " + (err.code || err.message));
  }
}

updateCounter();
