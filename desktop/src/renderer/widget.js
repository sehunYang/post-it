// Post-it 데스크톱 위젯 화면.
// 고정한 글을 그대로 고쳐 쓰고(멈추면 저장), 복사 버튼으로 클립보드에 넣습니다.
// + 버튼으로 새 글을 쓰면 저장과 동시에 위젯에 고정되고, 클립보드 아이콘은 지금 클립보드를 새 글로 저장합니다.
// 윗줄의 화살표로 접으면 윗줄만 남습니다.
// 클립보드에 파일이나 캡처한 그림이 있으면 Storage 에 올려 파일 글로 저장합니다(docs/FILES.md).
// 고정한 글이 파일 글이면 입력란 대신 미리보기와 파일 이름을 보여 주고, 복사 버튼은 파일을 클립보드에 넣습니다.
// 위젯 안에서 Ctrl+V 로 파일·그림을 붙여넣거나 파일을 끌어다 놓아도 올라갑니다.
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
/* 파일 글의 text: 파일 이름들을 ", " 로 이어 이만큼에서 자릅니다. (docs/FILES.md) */
const FILE_TEXT_MAX = 200;

const env = await api.env();
const app = createApp(env.emulator);
// 로그인은 IndexedDB 에 남아서, 컴퓨터를 다시 켜도 다시 로그인할 필요가 없습니다.
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
if (env.emulator) connectAuthEmulator(auth, EMULATOR_AUTH_URL, { disableWarnings: true });
const db = getDatabase(app);

let uid = null;
let pinned = null;          // { id, text, updatedAt, files, thumb } | null  (files 가 있으면 파일 글)
let unsubscribe = [];
let statusTimer = null;

/* 편집 상태 */
let draftId = null;         // 입력란이 고치고 있는 글. null 이면 저장할 때 새 글로 만듭니다.
let composing = false;      // + 로 새 글을 쓰는 중 (고정한 글로 되돌리지 않음)
let dirty = false;          // 아직 저장하지 않은 입력이 있음
let saveTimer = null;
let saving = Promise.resolve();
let working = false;        // 파일을 올리거나 받는 중 (버튼을 거듭 누르지 않게)

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
  if (!collapsed && uid && !$("editor").hidden) input.focus();
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
  const fileNote = shownFileNote();
  if (fileNote) {
    const count = fileNote.files.length > 1 ? `파일 ${fileNote.files.length}개 · ` : "";
    return `위젯에 고정됨 · ${count}${relative(fileNote.updatedAt)} 올림`;
  }
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

/** 올리기·받기처럼 오래 걸리는 동안 띄워 둡니다. 끝나면 flash 로 바꿉니다. */
function busy(message) {
  const el = $("status");
  el.className = "status is-ok";
  el.textContent = message;
  $("card").classList.add("is-busy");
  clearTimeout(statusTimer);
}

const flashing = () => $("card").classList.contains("is-busy");

setInterval(() => { if (!flashing()) showIdleStatus(); }, 30000);

/* ---------- 그리기 ---------- */
function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const fileNames = (files) => files.map((f) => f.name).join(", ");

/** 위젯이 지금 보여 주는 글이 파일 글이면 그 글. (+ 로 새 글을 쓰는 중이면 null) */
function shownFileNote() {
  return uid && !composing && !dirty && pinned && pinned.files && draftId === pinned.id ? pinned : null;
}

/** 파일 글: 첫 그림의 미리보기(thumb)와 파일마다 이름·크기 */
function renderAttach(note) {
  const img = $("attach-thumb");
  const thumb = typeof note.thumb === "string" && note.thumb.startsWith("data:image/") ? note.thumb : "";
  if ((img.getAttribute("src") || "") !== thumb) {
    if (thumb) img.src = thumb;
    else img.removeAttribute("src");
  }
  img.hidden = !thumb;
  const firstImage = note.files.find((f) => String(f.type).startsWith("image/"));
  img.alt = thumb && firstImage ? `${firstImage.name} 미리보기` : "";

  $("attach-list").replaceChildren(...note.files.map((f) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = f.name;
    name.title = f.name;
    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = formatSize(f.size);
    li.append(name, size);
    return li;
  }));
}

function render() {
  $("card").classList.remove("is-loading");
  $("signed-out").hidden = Boolean(uid);
  $("btn-copy").hidden = !uid;
  $("btn-new").hidden = !uid;
  $("btn-save-clip").hidden = !uid;
  $("peek").textContent = !uid ? "" : !pinned ? "고정한 글이 없습니다"
    : pinned.files ? fileNames(pinned.files) : pinned.text.split("\n")[0];

  // 입력란을 비우고(전체 선택 → 지우기) 나갔거나, + 를 누르고 아무것도 안 적은 채 나갔다면
  // 쓰던 글이 없는 것이므로 고정한 글(파일 글이면 미리보기)로 돌아갑니다.
  if (document.activeElement !== input && input.value.trim() === "") {
    dirty = false;
    composing = false;
  }

  // 쓰고 있는 글은 건드리지 않습니다. 입력란이 비어 있거나 다른 글로 고정이 바뀌었을 때만 채웁니다.
  if (uid && !composing && !dirty) {
    const nextId = pinned ? pinned.id : null;
    if (document.activeElement !== input || nextId !== draftId) {
      draftId = nextId;
      // 파일 글은 입력란에 넣지 않습니다. (고쳐 쓰지 않음)
      input.value = pinned && !pinned.files ? pinned.text : "";
    }
  }
  const fileNote = shownFileNote();
  $("editor").hidden = !uid || Boolean(fileNote);
  $("attach").hidden = !fileNote;
  if (fileNote) renderAttach(fileNote);
  updateCopyButton();
  if (!flashing()) showIdleStatus();
}

function updateCopyButton() {
  $("btn-copy").disabled = working || (!shownFileNote() && input.value.trim() === "");
}

/* ---------- 저장 ---------- */
/** 새 글을 만들고 같은 쓰기로 위젯에 고정합니다. (웹앱·폰과 같은 규칙) */
async function createPinnedNote(fields, key = push(ref(db, `users/${uid}/notes`)).key) {
  await update(ref(db, `users/${uid}`), {
    [`notes/${key}`]: { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
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
    if (!text) {
      // 빈 글은 저장하지 않습니다. 고칠 것이 남지 않았으니 고정한 글로 돌아갈 수 있게 합니다.
      if (input.value === raw) dirty = false;
      return showIdleStatus();
    }
    if (tooLong(text)) return;
    // 파일 글은 고쳐 쓰지 않습니다. (입력란이 숨어 있어 여기까지 올 일은 없지만, 혹시라도)
    if (draftId && pinned && pinned.id === draftId && pinned.files) {
      dirty = false;
      return;
    }
    try {
      if (draftId) {
        await update(ref(db, `users/${uid}/notes/${draftId}`), { text, updatedAt: serverTimestamp() });
      } else {
        draftId = await createPinnedNote({ text });
        composing = false;
        flash("저장하고 위젯에 고정했습니다");
      }
      // 저장하는 사이에 더 적었다면 그 내용은 다음 저장으로 넘깁니다.
      if (input.value === raw) dirty = false;
      // 저장하는 사이에 다른 기기가 다른 글(사진·파일 포함)을 고정했을 수 있으니 다시 그립니다.
      if (!dirty) render();
      else if (!flashing()) showIdleStatus();
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
  // 파일 글을 보고 있었다면 입력란을 먼저 보여 주고 포커스를 줍니다.
  // (render 는 포커스 없는 빈 입력란을 "쓰던 글 없음" 으로 보므로 순서가 중요합니다)
  $("attach").hidden = true;
  $("editor").hidden = false;
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
      // files 는 배열로 오지만, 사이가 빈 번호면 객체로 옵니다.
      const files = note && note.files
        ? Object.values(note.files).filter((f) => f && typeof f.path === "string" && typeof f.name === "string")
        : [];
      pinned = note ? {
        id: val.pinned,
        text: note.text || "",
        updatedAt: note.updatedAt || note.createdAt || 0,
        files: files.length ? files : null,
        thumb: note.thumb || null
      } : null;
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

/* ---------- 사진·파일: Storage 는 메인 프로세스가 사용자의 ID 토큰으로 부릅니다 ---------- */
async function storageAuth() {
  // 토큰을 못 받으면(오프라인 등) 글자는 그대로 저장하고, 파일은 메인 프로세스가 안내합니다.
  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  return { bucket: app.options.storageBucket, idToken: idToken || "" };
}

api.onFileProgress(({ phase, done, total }) => {
  if (!working) return;
  const label = phase === "upload" ? "올리는 중…" : "받는 중…";
  busy(total > 1 ? `${label} ${Math.min(done + 1, total)}/${total}` : label);
});

/** 파일 글 → 이 컴퓨터에 받아서 클립보드로 (탐색기에 붙이면 파일, 그림 한 장이면 그림으로도) */
async function copyFileNote(note) {
  if (working) return;
  working = true;
  updateCopyButton();
  busy("받는 중…");
  try {
    const files = note.files.map(({ path, name, type, size }) => ({ path, name, type, size }));
    const result = await api.copyFiles({ ...await storageAuth(), noteId: note.id, files });
    if (result.kind === "error") flash(result.message, "error");
    else flash("클립보드에 복사했습니다");
  } catch (err) {
    console.error(err);
    flash("복사 실패: " + (err.code || err.message), "error");
  } finally {
    working = false;
    updateCopyButton();
  }
}

/* ---------- 고정한 글 → 클립보드 ---------- */
$("btn-copy").addEventListener("click", async () => {
  const fileNote = shownFileNote();
  if (fileNote) return copyFileNote(fileNote);
  const text = input.value.trim();
  if (!text) return flash("복사할 글이 없습니다", "error");
  await api.copy(text);
  flash("클립보드에 복사했습니다");
  // 아직 저장 안 된 내용이 있으면 폰 위젯에도 바로 가도록 함께 저장합니다.
  flushSave();
});

/* ---------- 클립보드 → 새 글 (데스크톱 → 폰) ----------
 * 파일(탐색기에서 복사) → 그림(캡처) → 글자 순서로 봅니다. 파일·그림은 메인 프로세스가 먼저 올리고,
 * 여기서 글과 고정을 한 번에 씁니다. 그 쓰기가 실패하면 올린 파일을 지웁니다. (docs/FILES.md "순서") */
async function saveClipboardText(text, key) {
  text = text.trim();
  if (!text) return flash("클립보드에 글자가 없습니다", "error");
  if (tooLong(text)) return;
  await flushSave();
  // 새 글은 곧바로 위젯에 고정되고, 입력란도 그 글로 바뀝니다.
  composing = false;
  dirty = false;
  draftId = await createPinnedNote({ text }, key);
  input.value = text;
  updateCopyButton();
  flash("클립보드를 새 글로 저장하고 고정했습니다");
}

async function saveClipboardFiles({ files, thumb, skipped }, key, storage) {
  busy("저장하는 중…");
  await flushSave();
  composing = false;
  dirty = false;
  const note = { text: fileNames(files).slice(0, FILE_TEXT_MAX), files };
  if (thumb) note.thumb = thumb;
  try {
    draftId = await createPinnedNote(note, key);
  } catch (err) {
    api.discardUploads({ ...storage, paths: files.map((f) => f.path) });
    throw err;
  }
  input.value = "";
  render();
  const what = files.length === 1 && files[0].type.startsWith("image/") ? "그림" : "파일";
  flash(skipped
    ? `${what}을 올리고 고정했습니다 (폴더 ${skipped}개는 건너뜀)`
    : `${what}을 올리고 고정했습니다`);
}

/**
 * 클립보드(또는 끌어다 놓은 파일)를 새 글로 저장합니다.
 * pick 은 메인 프로세스에 올리기를 맡기고 { kind: "files" | "text" | "empty" | "error" } 를 돌려줍니다.
 */
async function saveNew(pick) {
  if (!uid || working) return;
  const owner = uid;
  working = true;
  updateCopyButton();
  try {
    const key = push(ref(db, `users/${uid}/notes`)).key;
    const storage = await storageAuth();
    const got = await pick({ ...storage, uid, noteId: key });
    if (uid !== owner) {
      // 올리는 사이에 로그아웃했다면 글을 쓰지 않고 올린 파일만 치웁니다.
      if (got.kind === "files") api.discardUploads({ ...storage, paths: got.files.map((f) => f.path) });
      return;
    }
    if (got.kind === "error") flash(got.message, "error");
    else if (got.kind === "empty") flash("클립보드가 비어 있습니다", "error");
    else if (got.kind === "text") await saveClipboardText(got.text, key);
    else await saveClipboardFiles(got, key, storage);
  } catch (err) {
    console.error(err);
    flash("저장 실패: " + (err.code || err.message), "error");
  } finally {
    working = false;
    updateCopyButton();
  }
}

$("btn-save-clip").addEventListener("click", () => saveNew((req) => api.saveClipboard(req)));

/* ---------- Ctrl+V 로 파일·그림 붙여넣기 ----------
 * 글자가 들어 있으면 평소처럼 입력란에 붙입니다(엑셀 셀처럼 그림이 함께 와도 글자).
 * 글자 없이 파일(탐색기에서 복사)이나 그림(캡처)만 있으면 "클립보드 저장" 과 같이 올립니다. */
document.addEventListener("paste", (e) => {
  if (!uid) return;
  const data = e.clipboardData;
  if (!data || data.types.includes("text/plain")) return;
  // 탐색기에서 복사한 파일이 붙여넣기 이벤트에 보이지 않을 수도 있어서, 무엇이 있는지는 메인 프로세스가 직접 봅니다.
  e.preventDefault();
  saveNew((req) => api.saveClipboard(req));
});

/* ---------- 파일 끌어다 놓기 ---------- */
const card = $("card");
const hasFiles = (e) => Boolean(e.dataTransfer) && Array.from(e.dataTransfer.types).includes("Files");

card.addEventListener("dragover", (e) => {
  if (!uid || !hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  card.classList.add("is-dragover");
});
card.addEventListener("dragleave", (e) => {
  if (!card.contains(e.relatedTarget)) card.classList.remove("is-dragover");
});
card.addEventListener("drop", (e) => {
  card.classList.remove("is-dragover");
  if (!uid || !hasFiles(e)) return;
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;
  saveNew((req) => api.saveDropped(req, files));
});
// 위젯 밖으로 떨어뜨리거나 놓친 파일이 창을 그 파일로 바꾸지 않게 합니다.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

/* 미리보기를 눌러도 위젯에 포커스가 가도록 — 그래야 그 상태에서 Ctrl+V 가 됩니다. */
$("attach").addEventListener("mousedown", () => $("attach").focus());

/* 숨겼다가 다시 보이면, 그사이 고정이 바뀌었을 수 있으니 다시 그립니다. */
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

$("btn-hide").addEventListener("click", async () => {
  await flushSave();
  api.hide();
});
$("btn-web").addEventListener("click", () => api.openWeb());
