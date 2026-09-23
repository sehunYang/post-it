// 기본 브라우저에서 열리는 로그인 페이지. 웹앱과 같은 팝업 로그인을 하고,
// 받은 Google 자격 증명만 위젯에 넘긴 뒤 이 브라우저에서는 바로 로그아웃합니다.
import {
  initializeAuth, browserPopupRedirectResolver, inMemoryPersistence,
  GoogleAuthProvider, signInWithPopup, signOut, connectAuthEmulator
} from "firebase/auth";
import { createApp, EMULATOR_AUTH_URL } from "../shared/firebase.js";

const boot = window.__POSTIT_BOOT__;
const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg; };

const app = createApp(boot.emulator);
const auth = initializeAuth(app, {
  persistence: inMemoryPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});
if (boot.emulator) connectAuthEmulator(auth, EMULATOR_AUTH_URL, { disableWarnings: true });

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

$("go").addEventListener("click", async () => {
  $("go").disabled = true;
  status("Google 로그인 창을 여는 중…");
  try {
    const result = await signInWithPopup(auth, provider);
    const cred = GoogleAuthProvider.credentialFromResult(result);
    if (!cred || !cred.idToken) throw new Error("Google 자격 증명을 받지 못했습니다.");

    const res = await fetch("/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: boot.state, idToken: cred.idToken })
    });
    if (!res.ok) throw new Error("위젯이 응답하지 않습니다. 위젯에서 로그인을 다시 눌러 주세요.");

    await signOut(auth);
    document.body.classList.add("done");
    $("title").textContent = "연결했습니다";
    $("lede").textContent = (result.user.email || "계정") + " 으로 위젯에 로그인했습니다. 이 탭은 닫아도 됩니다.";
    $("go").hidden = true;
    status("");
  } catch (err) {
    $("go").disabled = false;
    if (err && err.code === "auth/popup-closed-by-user") { status("로그인 창이 닫혔습니다. 다시 눌러 주세요."); return; }
    if (err && err.code === "auth/popup-blocked") { status("팝업이 막혔습니다. 주소창 오른쪽에서 팝업을 허용해 주세요."); return; }
    console.error(err);
    status("로그인 실패: " + ((err && (err.code || err.message)) || "알 수 없는 오류"));
  }
});
