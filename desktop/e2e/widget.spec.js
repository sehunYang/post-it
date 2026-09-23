// Post-it 데스크톱 위젯 E2E
//
// 실제 Electron 앱을 띄우고 Firebase 에뮬레이터(auth 9099, database 9000)에 붙여서
// 사용자가 하는 그대로 확인합니다. 커서는 진짜 OS 커서를 움직입니다.
const { test, expect, _electron: electron, chromium } = require("@playwright/test");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_DIR = path.join(__dirname, "..");
const PROJECT = "demo-postit";
const DB = "http://127.0.0.1:9000";
const NS = `${PROJECT}-default-rtdb`;
const AUTH = "http://127.0.0.1:9099";
const OWNER = { Authorization: "Bearer owner" }; // 에뮬레이터 관리자 권한
const LOGIN_ITEM = `PostIt-E2E-${process.pid}`;
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const IDLE_OPACITY = 0.4;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "postit-e2e-"));
const env = {
  ...process.env,
  POSTIT_E2E: "1",
  POSTIT_EMULATOR: "1",
  POSTIT_USER_DATA: userData,
  POSTIT_LOGIN_ITEM_NAME: LOGIN_ITEM
};

/* ---------- 도우미 ---------- */
async function launch(extraArgs = []) {
  const app = await electron.launch({ args: [APP_DIR, ...extraArgs], cwd: APP_DIR, env });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("#card")).not.toHaveClass(/is-loading/, { timeout: 15_000 });
  return { app, page };
}

const main = (app, fn, arg) => app.evaluate(fn, arg);
const isVisible = (app) => main(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
const bounds = (app) => main(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());

async function dbGet(p) {
  const r = await fetch(`${DB}/${p}.json?ns=${NS}`, { headers: OWNER });
  return r.json();
}
async function dbPut(p, value) {
  const r = await fetch(`${DB}/${p}.json?ns=${NS}`, { method: "PUT", headers: OWNER, body: JSON.stringify(value) });
  expect(r.ok).toBeTruthy();
}
async function onlyUser() {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
    method: "POST", headers: { ...OWNER, "Content-Type": "application/json" }, body: "{}"
  });
  const { userInfo = [] } = await r.json();
  expect(userInfo).toHaveLength(1);
  return userInfo[0];
}

/* 진짜 OS 커서를 옮기는 PowerShell 하나를 띄워 두고 재사용합니다. (Add-Type 컴파일이 느려서) */
let cursorShell = null;
function runInCursorShell(command) {
  if (!cursorShell) {
    const proc = spawn("powershell.exe", ["-NoProfile", "-NoLogo", "-Command", "-"], { stdio: ["pipe", "pipe", "inherit"] });
    proc.stdout.setEncoding("utf8");
    cursorShell = { proc, waiters: [], buf: "" };
    proc.stdout.on("data", (chunk) => {
      cursorShell.buf += chunk;
      while (cursorShell.buf.includes("__DONE__")) {
        cursorShell.buf = cursorShell.buf.slice(cursorShell.buf.indexOf("__DONE__") + 8);
        cursorShell.waiters.shift()?.();
      }
    });
    proc.stdin.write(
      "Add-Type -Name U -Namespace W -MemberDefinition '" +
      "[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x,int y);" +
      "[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();'\n" +
      "[W.U]::SetProcessDPIAware() | Out-Null\n"
    );
  }
  return new Promise((resolve) => {
    cursorShell.waiters.push(resolve);
    cursorShell.proc.stdin.write(command + "; Write-Output __DONE__\n");
  });
}

/** 진짜 OS 커서를 옮깁니다. (DIP 좌표 → 실제 픽셀로 바꿔서) */
async function moveCursor(app, dip) {
  const p = await main(app, ({ screen }, pt) => screen.dipToScreenPoint(pt), dip);
  await runInCursorShell(`[W.U]::SetCursorPos(${Math.round(p.x)},${Math.round(p.y)}) | Out-Null`);
}

const cardOpacity = (page) => page.locator("#card").evaluate((el) => Number(getComputedStyle(el).opacity));

function regQuery(name) {
  try {
    return execFileSync("reg", ["query", RUN_KEY, "/v", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/* ---------- 준비 / 정리 ---------- */
test.beforeAll(async () => {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await dbPut("", null);
});

test.afterAll(() => {
  if (cursorShell) cursorShell.proc.kill();
  try { execFileSync("reg", ["delete", RUN_KEY, "/v", LOGIN_ITEM, "/f"], { stdio: "ignore" }); } catch {}
});

test.describe.serial("데스크톱 위젯", () => {
  let app, page, uid;

  test.afterAll(async () => { if (app) await app.close().catch(() => {}); });

  test("처음 실행: 투명한 테두리 없는 위젯이 포커스를 뺏지 않고 뜨고, 로그인 안내를 보여 준다", async () => {
    ({ app, page } = await launch());
    await expect.poll(() => isVisible(app)).toBe(true);

    const win = await main(app, ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { onTop: w.isAlwaysOnTop(), resizable: w.isResizable(), focused: w.isFocused(), title: w.getTitle() };
    });
    expect(win.onTop).toBe(true);
    expect(win.resizable).toBe(false);
    expect(win.focused).toBe(false);

    await expect(page.locator("#signed-out")).toBeVisible();
    await expect(page.locator("#btn-signin")).toHaveText("Google 계정으로 로그인");
    await expect(page.locator("#status")).toHaveText("로그인이 필요합니다");
  });

  test("처음 실행하면 Windows 시작 시 자동 실행이 레지스트리에 등록된다", async () => {
    const entry = regQuery(LOGIN_ITEM);
    expect(entry, "Run 키에 값이 있어야 합니다").not.toBeNull();
    expect(entry).toMatch(/electron\.exe/i);
    expect(entry).toContain("--autostart");
    expect(await main(app, () => global.__postit.isAutostartEnabled())).toBe(true);
    const menu = await main(app, () => global.__postit.trayMenu());
    expect(menu.find((i) => i.label === "Windows 시작 시 자동 실행").checked).toBe(true);
  });

  test("평소에는 반투명, 커서가 올라오면 또렷하게, 벗어나면 다시 반투명", async () => {
    const b = await bounds(app);
    // 위젯에서 멀리 떨어진 곳
    await moveCursor(app, { x: Math.max(0, b.x - 300), y: b.y + b.height + 300 });
    await expect.poll(() => cardOpacity(page)).toBeCloseTo(IDLE_OPACITY, 2);

    await moveCursor(app, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    await expect.poll(() => main(app, () => global.__postit.isHovered())).toBe(true);
    await expect.poll(() => cardOpacity(page)).toBeCloseTo(1, 2);

    await moveCursor(app, { x: Math.max(0, b.x - 300), y: b.y + b.height + 300 });
    await expect.poll(() => cardOpacity(page)).toBeCloseTo(IDLE_OPACITY, 2);
  });

  test("로그인: 기본 브라우저의 로컬 로그인 페이지에서 Google 로그인 → 위젯이 로그인된다", async () => {
    test.setTimeout(120_000);
    await page.locator("#btn-signin").click();
    const url = await expect.poll(() => main(app, () => global.__postitLoginUrl || null)).not.toBeNull()
      .then(() => main(app, () => global.__postitLoginUrl));
    expect(url).toMatch(/^http:\/\/localhost:\d+\/login$/);

    // 위조된 자격 증명은 거절해야 합니다.
    const callback = url.replace("/login", "/callback");
    const post = (headers, body) => fetch(callback, { method: "POST", headers, body: JSON.stringify(body) });
    const json = { "Content-Type": "application/json" };
    const origin = new URL(url).origin;
    // 다른 사이트에서 보낸 요청 (Origin 이 다름)
    expect((await post({ ...json, Origin: "https://evil.example" }, { state: "0".repeat(48), idToken: "x" })).status).toBe(403);
    // 같은 출처라도 state 가 틀리면, 또 한글처럼 길이만 맞춘 값이어도 (앱이 죽지 않고) 거절
    expect((await post({ ...json, Origin: origin }, { state: "0".repeat(48), idToken: "x" })).status).toBe(400);
    expect((await post({ ...json, Origin: origin }, { state: "가".repeat(48), idToken: "x" })).status).toBe(400);
    // DNS 리바인딩처럼 다른 Host 이름으로 들어온 요청
    const port = new URL(url).port;
    const rebound = await new Promise((resolve) => {
      require("node:http").get({ host: "127.0.0.1", port, path: "/login", headers: { Host: "evil.example:" + port } },
        (res) => { res.resume(); resolve(res.statusCode); });
    });
    expect(rebound).toBe(403);

    // 사용자의 브라우저 대신 Chromium 으로 같은 페이지를 열어 로그인합니다.
    const browser = await chromium.launch();
    try {
      const loginPage = await browser.newPage();
      await loginPage.goto(url);
      // 갓 켜진 Auth 에뮬레이터는 첫 팝업 결과를 가끔 놓칩니다(에뮬레이터 쪽 문제).
      // 팝업이 닫히지 않으면 사용자처럼 창을 닫고 다시 누릅니다.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const [popup] = await Promise.all([
          loginPage.waitForEvent("popup"),
          loginPage.locator("#go").click()
        ]);
        // 에뮬레이터가 띄우는 가짜 Google 계정 선택 화면
        await popup.waitForLoadState("networkidle");
        await popup.getByText("Add new account").click();
        await popup.locator("#email-input").fill("teacher@example.com");
        await popup.locator("#display-name-input").fill("E2E 선생님");
        await popup.locator("#sign-in").click();
        const closed = await popup.waitForEvent("close", { timeout: 8000 }).then(() => true, () => false);
        if (closed) break;
        await popup.close();
        await expect(loginPage.locator("#go")).toBeEnabled({ timeout: 15_000 });
      }
      await expect(loginPage.locator("#title")).toHaveText("연결했습니다", { timeout: 15_000 });
    } finally {
      await browser.close();
    }

    await expect(page.locator("#signed-out")).toBeHidden({ timeout: 15_000 });
    await expect(page.locator("#note")).toBeVisible();
    await expect(page.locator("#note-text")).toContainText("고정한 글이 없습니다");
    const user = await onlyUser();
    expect(user.email).toBe("teacher@example.com");
    uid = user.localId;
  });

  test("웹앱에서 고정한 글이 실시간으로 뜨고, 누르면 클립보드로 복사된다", async () => {
    const now = Date.now();
    await dbPut(`users/${uid}`, {
      notes: {
        n1: { text: "첫 번째 글", createdAt: now - 60_000, updatedAt: now - 60_000 },
        n2: { text: "회의실 와이파이 비밀번호\npostit-2026!", createdAt: now, updatedAt: now }
      },
      pinned: "n2"
    });
    await expect(page.locator("#note-text")).toHaveText("회의실 와이파이 비밀번호\npostit-2026!");
    await expect(page.locator("#status")).toContainText("눌러서 복사");

    await main(app, ({ clipboard }) => clipboard.writeText("이전 내용"));
    await page.locator("#note").click();
    await expect(page.locator("#status")).toHaveText("클립보드에 복사했습니다");
    expect(await main(app, ({ clipboard }) => clipboard.readText())).toBe("회의실 와이파이 비밀번호\npostit-2026!");
    // 알림이 떠 있는 동안에는 커서가 없어도 또렷합니다.
    await expect.poll(() => cardOpacity(page)).toBeCloseTo(1, 2);

    // 다른 기기에서 고정을 바꾸면 바로 따라갑니다.
    await dbPut(`users/${uid}/pinned`, "n1");
    await expect(page.locator("#note-text")).toHaveText("첫 번째 글");
  });

  test("클립보드 아이콘: 지금 클립보드를 새 글로 저장한다 (고정은 그대로)", async () => {
    await main(app, ({ clipboard }) => clipboard.writeText("  데스크톱에서 보낸 글  "));
    await page.locator("#btn-save-clip").click();
    await expect(page.locator("#status")).toHaveText("클립보드를 새 글로 저장했습니다");

    const notes = await dbGet(`users/${uid}/notes`);
    const saved = Object.values(notes).find((n) => n.text === "데스크톱에서 보낸 글");
    expect(saved).toBeTruthy();
    expect(typeof saved.createdAt).toBe("number");
    expect(await dbGet(`users/${uid}/pinned`)).toBe("n1");

    // 빈 클립보드와 너무 긴 글은 저장하지 않습니다.
    await main(app, ({ clipboard }) => clipboard.writeText("   "));
    await page.locator("#btn-save-clip").click();
    await expect(page.locator("#status")).toHaveText("클립보드에 글자가 없습니다");
    await main(app, ({ clipboard }) => clipboard.writeText("가".repeat(5001)));
    await page.locator("#btn-save-clip").click();
    await expect(page.locator("#status")).toHaveText("글 하나는 5,000자까지 저장됩니다");
    expect(Object.keys(await dbGet(`users/${uid}/notes`))).toHaveLength(3);
  });

  test("껐다 켜기: 숨기기 버튼, 트레이, 명령줄(--toggle) 모두 동작한다", async () => {
    await page.locator("#btn-hide").click();
    await expect.poll(() => isVisible(app)).toBe(false);
    let menu = await main(app, () => global.__postit.trayMenu());
    expect(menu.find((i) => i.label === "위젯 보이기").checked).toBe(false);

    // 트레이 아이콘 클릭과 같은 동작
    await main(app, () => global.__postit.toggleWidget());
    await expect.poll(() => isVisible(app)).toBe(true);
    menu = await main(app, () => global.__postit.trayMenu());
    expect(menu.find((i) => i.label === "위젯 보이기").checked).toBe(true);

    // 이미 떠 있을 때 한 번 더 실행하면 새 창 없이 기존 위젯이 명령을 받습니다.
    const exe = await main(app, () => process.execPath);
    const second = spawn(exe, [APP_DIR, "--toggle"], { env, stdio: "ignore" });
    await new Promise((r) => second.on("exit", r));
    await expect.poll(() => isVisible(app)).toBe(false);
    expect(await main(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    const again = spawn(exe, [APP_DIR, "--toggle"], { env, stdio: "ignore" });
    await new Promise((r) => again.on("exit", r));
    await expect.poll(() => isVisible(app)).toBe(true);
  });

  test("창을 닫아도(Alt+F4) 앱은 트레이에 남고 위젯만 숨는다", async () => {
    await main(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => isVisible(app)).toBe(false);
    expect(await main(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await main(app, () => global.__postit.showWidget());
    await expect.poll(() => isVisible(app)).toBe(true);
  });

  test("다시 켜면(컴퓨터 재시작) 로그인·위치·켜짐 상태가 그대로 이어진다", async () => {
    await main(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setPosition(120, 140));
    await expect.poll(async () => {
      const s = JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8"));
      return [s.x, s.y];
    }).toEqual([120, 140]);
    await app.close();

    // 로그온 때와 같은 인자로 실행
    ({ app, page } = await launch(["--autostart"]));
    await expect.poll(() => isVisible(app)).toBe(true);
    expect(await bounds(app)).toMatchObject({ x: 120, y: 140 });
    await expect(page.locator("#note-text")).toHaveText("첫 번째 글", { timeout: 15_000 });

    // 꺼 둔 채로 재시작하면 트레이에만 조용히 떠 있습니다.
    await main(app, () => global.__postit.hideWidget());
    await app.close();
    ({ app, page } = await launch(["--autostart"]));
    await page.waitForTimeout(1500);
    expect(await isVisible(app)).toBe(false);
    await main(app, () => global.__postit.showWidget());
    await expect.poll(() => isVisible(app)).toBe(true);
  });

  test("트레이에서 자동 실행을 끄면 레지스트리에서 빠지고, 켜면 돌아온다", async () => {
    await main(app, () => global.__postit.setAutostart(false));
    expect(regQuery(LOGIN_ITEM)).toBeNull();
    expect(await main(app, () => global.__postit.isAutostartEnabled())).toBe(false);

    // 사용자가 끈 설정은 재시작해도 존중합니다.
    await app.close();
    ({ app, page } = await launch(["--autostart"]));
    expect(regQuery(LOGIN_ITEM)).toBeNull();

    await main(app, () => global.__postit.setAutostart(true));
    expect(regQuery(LOGIN_ITEM)).toContain("--autostart");
  });

  test("트레이의 로그아웃", async () => {
    await main(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("auth:signout"));
    await expect(page.locator("#signed-out")).toBeVisible();
    await expect(page.locator("#status")).toHaveText("로그인이 필요합니다");
  });
});
