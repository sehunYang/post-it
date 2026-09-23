// Post-it 데스크톱 위젯 — 메인 프로세스
//
// 바탕화면 구석에 떠 있는 작은 창 하나와 트레이 아이콘으로 이뤄집니다.
// 평소에는 반투명하게 비켜 있다가 커서가 올라오면 또렷해지고,
// 트레이 아이콘 / 위젯의 숨기기 버튼 / `Post-it.exe --toggle` 로 껐다 켤 수 있습니다.
const {
  app, BrowserWindow, Tray, Menu, ipcMain, clipboard, shell, screen, nativeImage
} = require("electron");
const path = require("node:path");
const settings = require("./settings");
const { startLoginServer } = require("./auth-server");

/* ---------- 실행 환경 ---------- */
// E2E 테스트는 격리된 사용자 폴더와 에뮬레이터를 씁니다. 설치본은 이 스위치들을 무시합니다.
const DEV = !app.isPackaged;
const devEnv = (name) => (DEV ? process.env[name] : undefined);
const EMULATOR = devEnv("POSTIT_EMULATOR") === "1";
const E2E = devEnv("POSTIT_E2E") === "1";
// 개발 실행이 설치본과 같은 설정 폴더·자동 실행 값을 덮어쓰지 않도록 따로 씁니다.
if (devEnv("POSTIT_USER_DATA")) app.setPath("userData", devEnv("POSTIT_USER_DATA"));
else if (DEV) app.setPath("userData", app.getPath("userData") + "-dev");
// 레지스트리 Run 값 이름 (설치본은 늘 "Post-it", NSIS 제거 프로그램이 이 이름을 지웁니다)
const LOGIN_ITEM_NAME = devEnv("POSTIT_LOGIN_ITEM_NAME") || (DEV ? "Post-it (dev)" : "Post-it");

const WIDGET_WIDTH = 320;
const WIDGET_HEIGHT = 176;
const HOVER_POLL_MS = 120;
const WEB_APP_URL = "https://shy.ai.kr/post-it/";

// 두 번째 실행은 새 창을 띄우지 않고, 이미 떠 있는 위젯에게 명령만 전합니다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.setAppUserModelId("kr.ai.shy.postit.desktop");

let win = null;
let tray = null;
let hovered = false;
let hoverTimer = null;
let loginServer = null;
let quitting = false;

/* ---------- 자동 시작 ---------- */
function loginItemOptions(extra = {}) {
  // 개발 중(`electron .`)에는 electron.exe 에 앱 폴더를 넘겨야 같은 앱이 뜹니다.
  const args = app.isPackaged ? ["--autostart"] : [app.getAppPath(), "--autostart"];
  return { path: process.execPath, args, name: LOGIN_ITEM_NAME, ...extra };
}

function isAutostartEnabled() {
  // openAtLogin 은 인자까지 비교하는데 Electron 이 읽을 때 스위치(--autostart)를 빠뜨려
  // 늘 false 가 나옵니다. 등록한 이름의 항목이 켜져 있는지로 봅니다.
  const { launchItems = [] } = app.getLoginItemSettings(loginItemOptions());
  return launchItems.some((item) => item.name === LOGIN_ITEM_NAME && item.enabled);
}

function setAutostart(enabled) {
  app.setLoginItemSettings(loginItemOptions({ openAtLogin: enabled, enabled }));
  settings.set({ autostart: enabled });
  refreshTray();
}

/* ---------- 위젯 창 ---------- */
function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WIDGET_WIDTH - 24,
    y: workArea.y + 24
  };
}

/** 저장된 위치가 지금 연결된 모니터 밖이면(모니터를 뺐을 때 등) 기본 위치로 돌립니다. */
function restoredPosition() {
  const { x, y } = settings.get();
  if (typeof x !== "number" || typeof y !== "number") return defaultPosition();
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    x + 40 > a.x && x < a.x + a.width - 40 && y >= a.y - 8 && y < a.y + a.height - 40
  );
  return visible ? { x, y } : defaultPosition();
}

function alive() {
  return Boolean(win && !win.isDestroyed());
}

function createWindow({ show = true } = {}) {
  const { x, y } = restoredPosition();
  win = new BrowserWindow({
    x, y,
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: settings.get().alwaysOnTop,
    title: "Post-it",
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "widget.html"));

  win.once("ready-to-show", () => {
    if (show && settings.get().visible) showWidget();
  });

  // 'moved' 는 Windows 에서 손으로 끌었을 때만 옵니다. 'move' 를 받아 잠시 뒤에 한 번 저장합니다.
  let saveTimer = null;
  win.on("move", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [nx, ny] = win.getPosition();
      settings.set({ x: nx, y: ny });
    }, 300);
  });

  // 창을 닫아도(Alt+F4 등) 앱은 트레이에 남고, 위젯만 숨깁니다.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    hideWidget();
  });
  // 로그오프·종료가 실제로 진행될 때(session-end)는 막지 않고 그대로 닫혀야 합니다.
  // query-session-end 는 다른 앱이 취소할 수 있으므로 여기서는 아무것도 바꾸지 않습니다.
  win.on("session-end", () => { quitting = true; });
  win.on("closed", () => {
    win = null;
    // 어떤 이유로든 창이 사라졌는데 앱은 살아 있다면, 트레이에서 다시 켤 수 있게 새로 만듭니다.
    if (!quitting) createWindow({ show: false });
  });

  // 위젯 안의 링크는 기본 브라우저로 엽니다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());

  startHoverWatch();
}

function showWidget() {
  if (!alive()) return;
  // 포커스를 뺏지 않고 떠야 다른 일을 방해하지 않습니다.
  win.showInactive();
  if (settings.get().alwaysOnTop) win.setAlwaysOnTop(true, "floating");
  settings.set({ visible: true });
  refreshTray();
}

function hideWidget() {
  if (!alive()) return;
  win.hide();
  settings.set({ visible: false });
  refreshTray();
}

function toggleWidget() {
  if (alive() && win.isVisible()) hideWidget();
  else showWidget();
}

/* ---------- 반투명 ↔ 또렷 ----------
 * 창은 포커스가 없어도 커서를 감지해야 합니다. 렌더러의 mouseenter 는 투명 창에서
 * 들쭉날쭉하므로, 메인에서 커서 위치를 짧은 주기로 보고 창 영역과 비교합니다. */
function startHoverWatch() {
  clearInterval(hoverTimer);
  hoverTimer = setInterval(() => {
    if (!alive() || !win.isVisible()) return setHovered(false);
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    setHovered(p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height);
  }, HOVER_POLL_MS);
}

function setHovered(next) {
  if (next === hovered) return;
  hovered = next;
  if (alive()) win.webContents.send("widget:hover", hovered);
}

/* ---------- 트레이 ---------- */
function trayImage() {
  const img = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "tray.png"));
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16, quality: "best" });
}

function buildTrayMenu() {
  const s = settings.get();
  return Menu.buildFromTemplate([
    { label: "위젯 보이기", type: "checkbox", checked: alive() && win.isVisible(), click: toggleWidget },
    {
      label: "항상 위에 표시", type: "checkbox", checked: s.alwaysOnTop,
      click: (item) => {
        settings.set({ alwaysOnTop: item.checked });
        if (alive()) win.setAlwaysOnTop(item.checked, "floating");
      }
    },
    {
      label: "Windows 시작 시 자동 실행", type: "checkbox", checked: isAutostartEnabled(),
      click: (item) => setAutostart(item.checked)
    },
    { label: "위치 초기화", click: resetPosition },
    { type: "separator" },
    { label: "웹앱 열기", click: () => shell.openExternal(WEB_APP_URL) },
    { label: "로그아웃", click: () => alive() && win.webContents.send("auth:signout") },
    { type: "separator" },
    { label: "종료", click: () => { quitting = true; app.quit(); } }
  ]);
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(alive() && win.isVisible() ? "Post-it · 위젯 켜짐" : "Post-it · 위젯 꺼짐");
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on("click", toggleWidget);
  refreshTray();
}

function resetPosition() {
  const { x, y } = defaultPosition();
  if (alive()) win.setPosition(x, y);
  settings.set({ x, y });
  showWidget();
}

/* ---------- 명령줄 (`Post-it.exe --toggle` 등) ---------- */
function handleCommand(argv) {
  if (argv.includes("--toggle")) toggleWidget();
  else if (argv.includes("--hide")) hideWidget();
  else if (argv.includes("--show") || !argv.includes("--autostart")) showWidget();
}

app.on("second-instance", (_e, argv) => handleCommand(argv));

/* ---------- 렌더러와 주고받기 ---------- */
ipcMain.handle("env:get", () => ({
  emulator: EMULATOR,
  version: app.getVersion()
}));

ipcMain.handle("clipboard:write", (_e, text) => {
  clipboard.writeText(String(text));
  return true;
});
ipcMain.handle("clipboard:read", () => clipboard.readText());

ipcMain.handle("widget:hide", () => hideWidget());
ipcMain.handle("app:open-web", () => shell.openExternal(WEB_APP_URL));

// Google 로그인은 위젯 안에서 할 수 없습니다(Google 이 내장 브라우저를 막습니다).
// 기본 브라우저로 로컬 로그인 페이지를 열고, 거기서 받은 자격 증명을 위젯에 넘깁니다.
ipcMain.handle("auth:start", async () => {
  // 아직 열려 있는 로그인이 있으면 같은 주소를 다시 엽니다. (먼저 연 탭도 그대로 쓸 수 있게)
  if (!loginServer || loginServer.closed) {
    loginServer = await startLoginServer({
      emulator: EMULATOR,
      onCredential: (credential) => {
        if (alive()) {
          win.webContents.send("auth:credential", credential);
          showWidget();
        }
        loginServer = null;
      }
    });
  }
  if (E2E) global.__postitLoginUrl = loginServer.url;
  else await shell.openExternal(loginServer.url);
  return loginServer.url;
});

/* ---------- 시작 ---------- */
app.whenReady().then(() => {
  // 처음 실행할 때 한 번 자동 시작을 켭니다. 이후에는 사용자가 트레이에서 고른 대로 둡니다.
  // (개발 실행은 테스트할 때만)
  if (settings.get().autostart === undefined && (!DEV || E2E)) setAutostart(true);
  createTray();
  createWindow();
  if (!process.argv.includes("--autostart") && !settings.get().visible) showWidget();
});

// 창이 숨겨져도 트레이에서 계속 삽니다.
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  quitting = true;
  clearInterval(hoverTimer);
  if (loginServer) loginServer.close();
});

// 테스트가 메인 프로세스 상태를 볼 수 있게 열어 둡니다.
if (E2E) {
  global.__postit = {
    toggleWidget, showWidget, hideWidget, setAutostart, isAutostartEnabled,
    loginItemOptions, trayMenu: () => buildTrayMenu().items.map((i) => ({ label: i.label, checked: i.checked })),
    isHovered: () => hovered
  };
}
