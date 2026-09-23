// E2E: 실제 Electron 앱을 띄우고 Firebase 에뮬레이터(auth, database)에 붙여 검사합니다.
// `npm run test:e2e` 가 에뮬레이터를 켜고 이 테스트를 돌립니다.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,               // 커서와 클립보드는 하나뿐이라 순서대로
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results"
});
