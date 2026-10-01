// Post-it 데스크톱 위젯 화면.
// 고정한 글을 그대로 고쳐 쓰고(멈추면 저장), 복사 버튼으로 클립보드에 넣습니다.
// + 버튼으로 새 글을 쓰면 저장과 동시에 위젯에 고정되고, 클립보드 아이콘은 지금 클립보드를 새 글로 저장합니다.
// 윗줄의 화살표로 접으면 윗줄만 남습니다.
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  onAuthStateChanged, signInWithCredential, signOut, GoogleAuthProvider, connectAuthEmulator
} from "firebase/auth";
import {
  getDatabase, ref, onValue, push, update, serverTimestamp
} from "firebase/database";
import { createApp, EMULATOR_AUTH_URL } from "../shared/firebase.js";

const $ = (id) => document.getElementById(id);
const api = window.postit;
const input = $("note-input");

/* 보안 규칙(database.rules.json)과 같은 값 */
const OWNER_UID = "PKfixfmWHlVOfBMPPvaileeINRC3";
const maxLen = () => (uid === OWNER_UID ? 20000 : 5000);
/* 입력을 멈추고 이만큼 지나면 저장합니다. */
const SAVE_DELAY_MS = 700;

const env = await api.env();
const app = createApp(env.emulator);
// 로그인은 IndexedDB 에 남아서, 컴퓨터를 다시 켜도 다시 로그인할 필요가 없습니다.
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
if (env.emulator) connectAuthEmulator(auth, EMULATOR_AUTH_URL, { disableWarnings: true });
const db = getDatabase(app);

let uid = null;
let pinned = null;          // { id, text, updatedAt } | null
let unsubscribe = [];
let statusTimer = null;

/* 편집 상태 */
let draftId = null;         // 입력란이 고치고 있는 글. null 이면 저장할 때 새 글로 만듭니다.
let composing = false;      // + 로 새 글을 쓰는 중 (고정한 글로 되돌리지 않음)
let dirty = false;          // 아직 저장하지 않은 입력이 있음
let saveTimer = null;
let saving = Promise.resolve();

/* ---------- 반투명 ↔ 또렷 (메인 프로세스가 커서 위치를 알려 줍니다) ---------- */
api.onHover((hovered) => document.documentElement.classList.toggle("is-hover", hovered));

/* ---------- 접기 ---------- */
function applyCollapsed(collapsed) {
  document.documentElement.classList.toggle("is-collapsed", collapsed);
  const btn = $("btn-collapse");
  const label = collapsed ? "펼치기" : "접기";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-expanded", String(!collapsed));
}

applyCollapsed(Boolean(env.collapsed));

$("btn-collapse").addEventListener("click", async () => {
  const collapsed = !document.documentElement.classList.contains("is-collapsed");
  if (collapsed) {
    await flushSave();
    input.blur();
  }
  applyCollapsed(collapsed);
  await api.setCollapsed(collapsed);
  if (!collapsed && uid) input.focus();
});

/* ---------- 상태 표시 ---------- */
function relative(ms) {
  if (!ms) return "";
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 1440)}일 전`;
}

function idleStatus() {
  if (!uid) return "로그인이 필요합니다";
  if (dirty) return input.value.trim() ? "입력 중…" : "빈 글은 저장되지 않습니다";
  if (composing || !draftId) return "적으면 저장되고 위젯에 고정됩니다";
  return pinned && pinned.id === draftId ? `위젯에 고정됨 · ${relative(pinned.updatedAt)} 수정` : "저장했습니다";
}

function showIdleStatus() {
  const el = $("status");
  el.className = "status";
  el.textContent = idleStatus();
  $("card").classList.remove("is-busy");
}

/** 잠깐 알림을 띄웁니다. 그동안은 커서가 없어도 위젯이 또렷하게 보입니다. */
function flash(message, kind = "ok") {
  const el = $("status");
  el.className = "status is-" + kind;
  el.textContent = message;
  $("card").classList.add("is-busy");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(showIdleStatus, 1800);
}

const flashing = () => $("card").classList.contains("is-busy");

setInterval(() => { if (!flashing()) showIdleStatus(); }, 30000);

/* ---------- 그리기 ---------- */
function render() {
  $("card").classList.remove("is-loading");
  $("signed-out").hidden = Boolean(uid);
  $("editor").hidden = !uid;
  $("btn-copy").hidden = !uid;
  $("btn-new").hidden = !uid;
  $("btn-save-clip").hidden = !uid;
  $("peek").textContent = uid ? (pinned ? pinned.text.split("\n")[0] : "고정한 글이 없습니다") : "";

  // 쓰고 있는 글은 건드리지 않습니다. 입력란이 비어 있거나 다른 글로 고정이 바뀌었을 때만 채웁니다.
  if (uid && !composing && !dirty) {
    const nextId = pinned ? pinned.id : null;
    if (document.activeElement !== input || nextId !== draftId) {
      draftId = nextId;
      input.value = pinned ? pinned.text : "";
    }
  }
  updateCopyButton();
  if (!flashing()) showIdleStatus();
}

function updateCopyButton() {
  $("btn-copy").disabled = input.value.trim() === "";
}

/* ---------- 저장 ---------- */
/** 새 글을 만들고 같은 쓰기로 위젯에 고정합니다. (웹앱·폰과 같은 규칙) */
async function createPinnedNote(text) {
  const key = push(ref(db, `users/${uid}/notes`)).key;
  await update(ref(db, `users/${uid}`), {
    [`notes/${key}`]: { text, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
    pinned: key
  });
  return key;
}

function tooLong(text) {
  if (text.length <= maxLen()) return false;
  flash(`글 하나는 ${maxLen().toLocaleString("ko-KR")}자까지 저장됩니다`, "error");
  return true;
}

/** 입력란의 내용을 저장합니다. 저장은 하나씩 차례로 일어납니다. */
function saveNow() {
  clearTimeout(saveTimer);
  saving = saving.then(async () => {
    if (!uid || !dirty) return;
    const raw = input.value;
    const text = raw.trim();
    if (!text) return showIdleStatus();
    if (tooLong(text)) return;
    try {
      if (draftId) {
        await update(ref(db, `users/${uid}/notes/${draftId}`), { text, updatedAt: serverTimestamp() });
      } else {
        draftId = await createPinnedNote(text);
        composing = false;
        flash("저장하고 위젯에 고정했습니다");
      }
      // 저장하는 사이에 더 적었다면 그 내용은 다음 저장으로 넘깁니다.
      if (input.value === raw) dirty = false;
      if (!flashing()) showIdleStatus();
    } catch (err) {
      console.error(err);
      flash("저장 실패: " + (err.code || err.message), "error");
    }
  });
  return saving;
}

/** 기다리는 저장이 있으면 바로 저장하고 끝날 때까지 기다립니다. */
function flushSave() {
  return dirty ? saveNow() : saving;
}

input.addEventListener("input", () => {
  dirty = true;
  updateCopyButton();
  if (!flashing()) showIdleStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveNow();
  } else if (e.key === "Escape") {
    input.blur();
  }
});

input.addEventListener("blur", async () => {
  await flushSave();
  // 새 글을 쓰려다 아무것도 적지 않고 나가면 고정한 글로 돌아갑니다.
  if (composing && !dirty && input.value.trim() === "") composing = false;
  render();
});

/* ---------- 새 글 ---------- */
$("btn-new").addEventListener("click", async () => {
  if (!uid) return;
  await flushSave();
  composing = true;
  dirty = false;
  draftId = null;
  input.value = "";
  if (document.documentElement.classList.contains("is-collapsed")) {
    applyCollapsed(false);
    await api.setCollapsed(false);
  }
  input.focus();
  render();
});

/* ---------- 로그인 ---------- */
onAuthStateChanged(auth, (user) => {
  for (const off of unsubscribe) off();
  unsubscribe = [];
  uid = user ? user.uid : null;
  pinned = null;
  draftId = null;
  composing = false;
  dirty = false;
  clearTimeout(saveTimer);
  input.value = "";
  if (!user) return render();

  unsubscribe.push(onValue(ref(db, ".info/connected"), (snap) => {
    $("dot").classList.toggle("is-online", snap.val() === true);
  }));
  unsubscribe.push(onValue(
    ref(db, `users/${uid}`),
    (snap) => {
      const val = snap.val() || {};
      const note = val.pinned && val.notes && val.notes[val.pinned];
      pinned = note ? { id: val.pinned, text: note.text || "", updatedAt: note.updatedAt || note.createdAt || 0 } : null;
      render();
    },
    (err) => {
      console.error(err);
      flash("읽기 실패: " + (err.code || err.message), "error");
    }
  ));
  render();
});

$("btn-signin").addEventListener("click", async () => {
  const btn = $("btn-signin");
  btn.disabled = true;
  flash("브라우저에서 로그인을 마쳐 주세요", "ok");
  try {
    await api.startLogin();
  } catch (err) {
    console.error(err);
    flash("로그인을 시작하지 못했습니다", "error");
  } finally {
    setTimeout(() => { btn.disabled = false; }, 3000);
  }
});

api.onCredential(async ({ idToken }) => {
  try {
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    flash("로그인했습니다");
  } catch (err) {
    console.error(err);
    flash("로그인 실패: " + (err.code || err.message), "error");
  }
});

api.onSignOutRequest(async () => {
  await flushSave();
  signOut(auth);
});

/* ---------- 입력란의 글 → 클립보드 ---------- */
$("btn-copy").addEventListener("click", async () => {
  const text = input.value.trim();
  if (!text) return flash("복사할 글이 없습니다", "error");
  await api.copy(text);
  flash("클립보드에 복사했습니다");
  // 아직 저장 안 된 내용이 있으면 폰 위젯에도 바로 가도록 함께 저장합니다.
  flushSave();
});

/* ---------- 클립보드 → 새 글 (데스크톱 → 폰) ---------- */
$("btn-save-clip").addEventListener("click", async () => {
  if (!uid) return;
  const text = String(await api.readClipboard() || "").trim();
  if (!text) return flash("클립보드에 글자가 없습니다", "error");
  if (tooLong(text)) return;
  try {
    await flushSave();
    // 새 글은 곧바로 위젯에 고정되고, 입력란도 그 글로 바뀝니다.
    composing = false;
    dirty = false;
    draftId = await createPinnedNote(text);
    input.value = text;
    updateCopyButton();
    flash("클립보드를 새 글로 저장하고 고정했습니다");
  } catch (err) {
    console.error(err);
    flash("저장 실패: " + (err.code || err.message), "error");
  }
});

$("btn-hide").addEventListener("click", async () => {
  await flushSave();
  api.hide();
});
$("btn-web").addEventListener("click", () => api.openWeb());
