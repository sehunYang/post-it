// Post-it 데스크톱 위젯 화면.
// 폰 위젯과 같은 일을 합니다: 고정한 글을 보여 주고, 누르면 클립보드로 복사,
// 클립보드 아이콘을 누르면 지금 클립보드를 새 글로 저장.
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  onAuthStateChanged, signInWithCredential, signOut, GoogleAuthProvider, connectAuthEmulator
} from "firebase/auth";
import {
  getDatabase, ref, onValue, push, set, serverTimestamp
} from "firebase/database";
import { createApp, EMULATOR_AUTH_URL } from "../shared/firebase.js";

const $ = (id) => document.getElementById(id);
const api = window.postit;

/* 보안 규칙(database.rules.json)과 같은 값 */
const OWNER_UID = "PKfixfmWHlVOfBMPPvaileeINRC3";
const maxLen = () => (uid === OWNER_UID ? 20000 : 5000);

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

/* ---------- 반투명 ↔ 또렷 (메인 프로세스가 커서 위치를 알려 줍니다) ---------- */
api.onHover((hovered) => document.documentElement.classList.toggle("is-hover", hovered));

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
  if (!pinned) return "웹앱이나 폰에서 글을 고정하세요";
  return `눌러서 복사 · ${relative(pinned.updatedAt)} 수정`;
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

setInterval(() => { if (!$("card").classList.contains("is-busy")) showIdleStatus(); }, 30000);

/* ---------- 그리기 ---------- */
function render() {
  $("card").classList.remove("is-loading");
  $("signed-out").hidden = Boolean(uid);
  $("note").hidden = !uid;
  $("btn-save-clip").hidden = !uid;

  if (uid) {
    const note = $("note");
    note.classList.toggle("is-empty", !pinned);
    $("note-text").textContent = pinned ? pinned.text : "고정한 글이 없습니다. 웹앱에서 “위젯에 고정”을 누르면 여기에 뜹니다.";
    note.disabled = !pinned;
  }
  if (!$("card").classList.contains("is-busy")) showIdleStatus();
}

/* ---------- 로그인 ---------- */
onAuthStateChanged(auth, (user) => {
  for (const off of unsubscribe) off();
  unsubscribe = [];
  uid = user ? user.uid : null;
  pinned = null;
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

api.onSignOutRequest(() => signOut(auth));

/* ---------- 고정한 글 → 클립보드 ---------- */
$("note").addEventListener("click", async () => {
  if (!pinned) return;
  await api.copy(pinned.text);
  flash("클립보드에 복사했습니다");
});

/* ---------- 클립보드 → 새 글 (데스크톱 → 폰) ---------- */
$("btn-save-clip").addEventListener("click", async () => {
  if (!uid) return;
  const text = String(await api.readClipboard() || "").trim();
  if (!text) return flash("클립보드에 글자가 없습니다", "error");
  if (text.length > maxLen()) {
    return flash(`글 하나는 ${maxLen().toLocaleString("ko-KR")}자까지 저장됩니다`, "error");
  }
  try {
    const created = push(ref(db, `users/${uid}/notes`));
    await set(created, { text, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    // 웹앱과 같이, 고정된 글이 없으면 방금 저장한 글을 고정합니다.
    if (!pinned) await set(ref(db, `users/${uid}/pinned`), created.key);
    flash("클립보드를 새 글로 저장했습니다");
  } catch (err) {
    console.error(err);
    flash("저장 실패: " + (err.code || err.message), "error");
  }
});

$("btn-hide").addEventListener("click", () => api.hide());
$("btn-web").addEventListener("click", () => api.openWeb());
