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

const input = $("input");
const btnSave = $("btn-save");
const btnCancelEdit = $("btn-cancel-edit");

onAuthStateChanged(auth, (user) => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  if (!user) {
    uid = null;
    notes = [];
    pinnedId = null;
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
  b.addEventListener("click", onClick);
  return b;
}

function render() {
  const list = $("list");
  list.textContent = "";
  $("empty").hidden = notes.length > 0;

  // 고정된 글을 목록 맨 위로
  const ordered = notes.slice().sort((a, b) => (b.id === pinnedId) - (a.id === pinnedId));

  for (const note of ordered) {
    const isPinned = note.id === pinnedId;
    const li = document.createElement("li");
    li.className = "note" + (isPinned ? " is-pinned" : "");

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
