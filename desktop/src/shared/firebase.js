// 웹앱과 같은 Firebase 프로젝트에 붙습니다. 설정값은 웹앱의 js/firebase-config.js 를 그대로 씁니다.
import { initializeApp } from "firebase/app";
import { firebaseConfig } from "../../../js/firebase-config.js";

// E2E 테스트는 실제 서버 대신 Firebase 에뮬레이터(demo- 프로젝트)를 씁니다.
export const EMULATOR_AUTH_URL = "http://127.0.0.1:9099";
const EMULATOR_CONFIG = {
  apiKey: "demo-key",
  authDomain: "demo-postit.firebaseapp.com",
  projectId: "demo-postit",
  databaseURL: "http://127.0.0.1:9000?ns=demo-postit-default-rtdb"
};

export function createApp(emulator) {
  return initializeApp(emulator ? EMULATOR_CONFIG : firebaseConfig);
}
