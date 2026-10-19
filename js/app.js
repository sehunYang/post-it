import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithCredential,
  signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, push, set, update, remove, onValue, serverTimestamp, connectDatabaseEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import {
  getStorage, ref as fileRef, uploadBytes, getBlob, deleteObject, connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------- 유틸 ---------- */
const $ = (id) => document.getElementById(id);

/* 보안 규칙(database.rules.json)과 같은 값. 소유자만 더 긴 글을 저장할 수 있습니다. */
const OWNER_UID = "PKfixfmWHlVOfBMPPvaileeINRC3";
const MAX_LEN_OWNER = 20000;
const MAX_LEN = 5000;
const maxLen = () => (uid === OWNER_UID ? MAX_LEN_OWNER : MAX_LEN);

/* 사진·파일 (docs/FILES.md, storage.rules 와 같은 값) */
const MAX_FILES = 10;
const MAX_FILE_BYTES_OWNER = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const maxFileBytes = () => (uid === OWNER_UID ? MAX_FILE_BYTES_OWNER : MAX_FILE_BYTES);
const THUMB_SIDE = 320;
const THUMB_MAX_CHARS = 60000;

const INSTALL_URL = "https://shy.ai.kr/post-it/install/";
const PHONE_PANEL_KEY = "postit.phonePanel";

/** 규칙에 막힌 쓰기를 고장으로 보이지 않게 풀어 씁니다. */
function friendly(err) {
  const msg = String(err && (err.code || err.message) || "");
  if (/storage\/unauthorized/i.test(msg)) {
    return `파일 하나는 ${formatBytes(maxFileBytes())}까지 올릴 수 있습니다.`;
  }
  if (/permission[_-]denied/i.test(msg)) {
    return `글 하나는 ${maxLen().toLocaleString("ko-KR")}자까지 저장할 수 있습니다.`;
  }
  return msg || "실패했습니다.";
}

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

function formatBytes(n) {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + "KB";
  return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + "MB";
}

const isImage = (file) => /^image\//.test(file.type || "");

/** 파일 이름 다듬기 — 세 클라이언트가 같은 규칙을 씁니다(docs/FILES.md). */
function cleanName(name) {
  let n = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "");
  if (n.length > 200) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 16 ? n.slice(dot) : "";
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n || "file";
}

/** 스크린샷처럼 이름 없이 붙여넣은 이미지의 이름 */
function pastedImageName() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `이미지-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
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
// 로컬에서 `?emulator` 로 열면 Firebase 에뮬레이터에 붙습니다(개발·테스트용). 배포 주소에서는 꺼져 있습니다.
const EMULATOR = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) &&
  new URLSearchParams(location.search).has("emulator");

const app = initializeApp(EMULATOR ? {
  apiKey: "demo-key",
  authDomain: "demo-postit.firebaseapp.com",
  projectId: "demo-postit",
  databaseURL: "http://127.0.0.1:9000?ns=demo-postit-default-rtdb",
  storageBucket: "demo-postit.appspot.com"
} : firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

if (EMULATOR) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  // 테스트가 팝업 없이 로그인할 수 있게 열어 둡니다. (에뮬레이터는 서명 없는 토큰을 받습니다)
  window.__postitTest = {
    signIn: (sub, email) => signInWithCredential(auth, GoogleAuthProvider.credential(
      JSON.stringify({ sub, email, email_verified: true })
    ))
  };
}
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
    $("denied").hidden = true;
    $("gate").hidden = false;
    $("app").hidden = true;
    return;
  }

  uid = user.uid;
  $("gate").hidden = true;
  $("denied").hidden = true;
  $("app").hidden = false;
  $("account-name").textContent = user.displayName || "내 계정";
  $("account-mail").textContent = user.email || "";
  if (user.photoURL) $("avatar").src = user.photoURL;
  updateCounter();
  renderPhonePanel();

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
          updatedAt: (n && n.updatedAt) || 0,
          // RTDB 는 배열을 {"0": …} 로 돌려줄 때도 있어서 값만 모읍니다.
          files: Object.values((n && n.files) || {}).filter((f) => f && f.path),
          thumb: (n && n.thumb) || ""
        }))
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      render();
    },
    (err) => {
      // 허용된 계정이 아니면 목록 읽기가 막힙니다. 고장난 앱처럼 보이지 않게 안내를 띄웁니다.
      const denied =
        err.code === "PERMISSION_DENIED" ||
        /permission_denied/i.test(err.message || "");
      if (denied) {
        showDenied();
        return;
      }
      console.error(err);
      toast("읽기 실패: " + (err.code || err.message));
    }
  );
});

function showDenied() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  notes = [];
  orderedNotes = [];
  pinnedId = null;
  clearSelection();
  $("app").hidden = true;
  $("gate").hidden = true;
  $("denied").hidden = false;
}

$("btn-signout-denied").addEventListener("click", () => {
  $("denied").hidden = true;
  signOut(auth);
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

    if (note.files.length) li.appendChild(renderAttachment(note));
    else {
      const p = document.createElement("p");
      p.className = "note-text";
      p.textContent = note.text;
      li.appendChild(p);
    }

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

    if (!note.files.length) {
      foot.appendChild(makeButton("복사", "primary", async () => {
        const ok = await copyText(note.text);
        toast(ok ? "클립보드에 복사했습니다." : "복사에 실패했습니다.");
      }));
    } else if (note.files.length === 1 && isImage(note.files[0])) {
      // 브라우저는 그림 한 장만 클립보드에 넣을 수 있습니다. 나머지는 내려받기로.
      foot.appendChild(makeButton("복사", "primary", () => copyImage(note.files[0])));
      foot.appendChild(makeButton("내려받기", "", () => downloadFiles(note.files)));
    } else {
      foot.appendChild(makeButton("내려받기", "primary", () => downloadFiles(note.files)));
    }
    foot.appendChild(makeButton(isPinned ? "고정 해제" : "위젯에 고정", "", () => togglePin(note.id)));
    // 파일 글은 고쳐 쓰지 않습니다(docs/FILES.md).
    if (!note.files.length) foot.appendChild(makeButton("수정", "", () => startEdit(note)));
    foot.appendChild(makeButton("삭제", "danger", () => removeNote(note)));

    li.appendChild(foot);
    list.appendChild(li);
  }

  updateSelectionBar();
}

/** 파일 글: 미리보기 + 파일 이름과 크기 */
function renderAttachment(note) {
  const box = document.createElement("div");
  box.className = "attachment";

  if (note.thumb) {
    const img = document.createElement("img");
    img.className = "attachment-thumb";
    img.src = note.thumb;
    img.alt = "";
    img.draggable = false;
    box.appendChild(img);
  }

  const ul = document.createElement("ul");
  ul.className = "attachment-files";
  for (const f of note.files) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = (isImage(f) ? "🖼 " : "📄 ") + f.name;
    const size = document.createElement("span");
    size.className = "muted";
    size.textContent = formatBytes(f.size || 0);
    li.append(name, size);
    ul.appendChild(li);
  }
  box.appendChild(ul);
  return box;
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
    const gone = notes.filter((n) => ids.includes(n.id));
    await update(ref(db, `users/${uid}`), updates);
    deleteFiles(gone.flatMap((n) => n.files));
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
  const n = input.value.length;
  $("counter").textContent =
    n.toLocaleString("ko-KR") + " / " + maxLen().toLocaleString("ko-KR") + "자";
  $("counter").classList.toggle("is-over", n > maxLen());
}

/* ---------- 폰 설치 패널 (QR) ---------- */
let qrDrawn = false;
function renderPhonePanel() {
  const panel = $("phone-panel");
  panel.open = localStorage.getItem(PHONE_PANEL_KEY) !== "closed";
  if (qrDrawn) return;
  qrDrawn = true;

  const box = $("qr");
  box.href = INSTALL_URL;
  $("install-url").textContent = INSTALL_URL.replace(/^https:\/\//, "");
  try {
    // qrcode-generator (전역 qrcode). CDN 이 막히면 주소 글자만 남습니다.
    const qr = window.qrcode(0, "M");
    qr.addData(INSTALL_URL);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (err) {
    console.warn("QR 생성 실패", err);
    box.textContent = INSTALL_URL;
  }
}

$("phone-panel").addEventListener("toggle", (e) => {
  localStorage.setItem(PHONE_PANEL_KEY, e.target.open ? "open" : "closed");
});

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
  if (text.length > maxLen()) {
    toast("글 하나는 " + maxLen().toLocaleString("ko-KR") + "자까지 저장할 수 있습니다.");
    return;
  }

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
      // 새 글은 곧바로 위젯에 고정합니다. 한 번의 쓰기로 묶어 고정만 빠지는 일이 없게 합니다.
      const key = push(ref(db, "users/" + uid + "/notes")).key;
      await update(ref(db, "users/" + uid), {
        ["notes/" + key]: {
          text,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        pinned: key
      });
      input.value = "";
      updateCounter();
      toast("저장하고 위젯에 고정했습니다.");
    }
  } catch (err) {
    console.error(err);
    toast("저장 실패: " + friendly(err));
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
    deleteFiles(note.files);
    if (pinnedId === note.id) await set(ref(db, "users/" + uid + "/pinned"), null);
    if (editingId === note.id) cancelEdit();
    toast("삭제했습니다.");
  } catch (err) {
    console.error(err);
    toast("삭제 실패: " + (err.code || err.message));
  }
}

/* ---------- 사진·파일 (docs/FILES.md) ---------- */

/** 글에 딸린 파일을 Storage 에서 지웁니다. 글은 이미 지워졌으므로 실패해도 그냥 둡니다. */
function deleteFiles(files) {
  for (const f of files) {
    deleteObject(fileRef(storage, f.path)).catch((err) => console.warn("파일 삭제 실패", f.path, err));
  }
}

/** 첫 번째 이미지로 미리보기(긴 변 320px JPEG)를 만듭니다. 실패하면 빈 문자열. */
async function makeThumb(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    // 투명한 PNG 가 JPEG 에서 검게 되지 않도록 흰 바탕을 깝니다.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.7, 0.5, 0.3]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= THUMB_MAX_CHARS) return url;
    }
  } catch (err) {
    console.warn("미리보기를 만들지 못했습니다", err);
  }
  return "";
}

let uploading = false;

/**
 * 파일들을 올리고 새 글로 저장해 위젯에 고정합니다.
 * 파일을 먼저 올리고, 글과 고정은 한 번의 쓰기로 묶습니다. 그 쓰기가 실패하면 올린 파일을 지웁니다.
 */
async function uploadFiles(list, { pasted = false } = {}) {
  if (!uid || uploading) return;
  const files = [...list];
  if (files.length === 0) return;
  if (files.length > MAX_FILES) {
    toast(`파일은 한 번에 ${MAX_FILES}개까지 올릴 수 있습니다.`);
    return;
  }
  const big = files.find((f) => f.size > maxFileBytes());
  if (big) {
    toast(`"${big.name}" 이 너무 큽니다. 파일 하나는 ${formatBytes(maxFileBytes())}까지입니다.`);
    return;
  }
  const empty = files.find((f) => f.size === 0);
  if (empty) {
    // 폴더를 끌어다 놓으면 크기 0 인 항목으로 들어옵니다.
    toast(`"${empty.name}" 은 올릴 수 없습니다. 폴더는 지원하지 않습니다.`);
    return;
  }

  uploading = true;
  setUploadBusy(true);
  const key = push(ref(db, "users/" + uid + "/notes")).key;
  const uploaded = [];
  try {
    const meta = files.map((f, i) => {
      // 스크린샷을 그대로 붙여넣으면 브라우저가 "image.png" 라는 이름을 붙입니다.
      const raw = pasted && f.name === "image.png" && isImage(f) ? pastedImageName() : f.name;
      const name = cleanName(raw);
      return {
        path: `users/${uid}/${key}/${i}/${name}`,
        name,
        type: f.type || "application/octet-stream",
        size: f.size
      };
    });

    for (const [i, f] of files.entries()) {
      toast(files.length > 1 ? `올리는 중… (${i + 1}/${files.length})` : "올리는 중…");
      await uploadBytes(fileRef(storage, meta[i].path), f, { contentType: meta[i].type });
      uploaded.push(meta[i]);
    }

    const firstImage = files.find(isImage);
    const thumb = firstImage ? await makeThumb(firstImage) : "";
    const note = {
      text: meta.map((m) => m.name).join(", ").slice(0, 200),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      files: meta
    };
    if (thumb) note.thumb = thumb;

    await update(ref(db, "users/" + uid), { ["notes/" + key]: note, pinned: key });
    toast(files.length > 1
      ? `파일 ${files.length}개를 올리고 위젯에 고정했습니다.`
      : "올리고 위젯에 고정했습니다.");
  } catch (err) {
    console.error(err);
    deleteFiles(uploaded);
    toast("올리기 실패: " + friendly(err));
  } finally {
    uploading = false;
    setUploadBusy(false);
  }
}

function setUploadBusy(busy) {
  $("btn-attach").disabled = busy;
  $("btn-attach").textContent = busy ? "올리는 중…" : "사진·파일 첨부";
  $("composer").classList.toggle("is-busy", busy);
}

function fetchFile(file) {
  return getBlob(fileRef(storage, file.path));
}

/** 어떤 형식의 그림이든 PNG 로 바꿉니다. 브라우저 클립보드는 그림을 PNG 로만 받습니다. */
async function toPng(blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))), "image/png")
  );
}

async function copyImage(file) {
  toast("받는 중…");
  try {
    // ClipboardItem 에 Promise 를 넘겨야 받는 동안에도 사용자 동작으로 인정됩니다(Safari).
    const png = fetchFile(file).then(toPng);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast("그림을 클립보드에 복사했습니다.");
  } catch (err) {
    console.error(err);
    toast("복사에 실패했습니다. 내려받기를 이용해 주세요.");
  }
}

async function downloadFiles(files) {
  toast(files.length > 1 ? `받는 중… (${files.length}개)` : "받는 중…");
  try {
    for (const f of files) {
      const url = URL.createObjectURL(await fetchFile(f));
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    toast(files.length > 1 ? `${files.length}개를 내려받았습니다.` : "내려받았습니다.");
  } catch (err) {
    console.error(err);
    toast("내려받기 실패: " + (err.code || err.message));
  }
}

/* 첨부 버튼 */
$("btn-attach").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  uploadFiles(files);
});

/* 붙여넣기: 파일이나 그림이 들어 있으면 올립니다.
   입력창에 붙여넣는데 글자도 함께 들어 있으면(워드·웹 문서 복사 등) 평소처럼 글자를 붙입니다. */
document.addEventListener("paste", (e) => {
  if (!uid || $("app").hidden) return;
  const data = e.clipboardData;
  const files = data ? [...data.files] : [];
  if (files.length === 0) return;
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (typing && data.types.includes("text/plain")) return;
  e.preventDefault();
  uploadFiles(files, { pasted: true });
});

/* 끌어다 놓기 */
const composerBox = $("composer");
composerBox.addEventListener("dragover", (e) => {
  if (!e.dataTransfer.types.includes("Files")) return;
  e.preventDefault();
  composerBox.classList.add("is-dragover");
});
composerBox.addEventListener("dragleave", (e) => {
  if (!composerBox.contains(e.relatedTarget)) composerBox.classList.remove("is-dragover");
});
composerBox.addEventListener("drop", (e) => {
  composerBox.classList.remove("is-dragover");
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  uploadFiles(e.dataTransfer.files);
});

updateCounter();
