// 위젯 설정 — 사용자 폴더의 settings.json 한 파일에 둡니다.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
  visible: true,       // 위젯이 켜져 있는지
  alwaysOnTop: true,   // 다른 창 위에 떠 있는지
  x: undefined,        // 마지막 위치
  y: undefined,
  autostart: undefined // 처음 실행 때 한 번 켜고, 이후로는 사용자가 고른 값
};

let cache = null;
const file = () => path.join(app.getPath("userData"), "settings.json");

function get() {
  if (!cache) {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), "utf8")) };
    } catch {
      cache = { ...DEFAULTS };
    }
  }
  return cache;
}

function set(patch) {
  cache = { ...get(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    // 쓰는 도중 꺼져도 설정이 깨지지 않도록 임시 파일에 쓴 뒤 바꿔치기합니다.
    const tmp = file() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error("설정 저장 실패", err);
  }
  return cache;
}

module.exports = { get, set };
