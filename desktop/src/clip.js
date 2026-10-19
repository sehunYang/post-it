// 클립보드 ↔ 사진·파일 (docs/FILES.md)
//
// "클립보드 저장": 탐색기에서 복사한 파일 → 캡처한 그림 → 글자 순서로 클립보드를 보고,
//   파일·그림이면 Storage 에 올린 뒤 글에 넣을 files · thumb 를 돌려줍니다. 글 쓰기는 위젯 화면이 합니다.
// 파일 글의 "복사": 파일을 사용자 폴더의 received/ 에 받아 두고, 그 파일들을 클립보드에 올립니다.
//
// Windows 의 파일 목록(CF_HDROP)은 Electron 이 읽고 쓰지 못해서 PowerShell 을 잠깐 띄워 다룹니다.
// Electron 44 의 클립보드는 웹과 같은 비동기 방식입니다(read/write 와 ClipboardItem, 그림은 image/png).
const { app, clipboard, nativeImage, ClipboardItem } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/* 규약(docs/FILES.md)과 보안 규칙(storage.rules, database.rules.json)과 같은 값 */
const OWNER_UID = "PKfixfmWHlVOfBMPPvaileeINRC3";
const MB = 1024 * 1024;
const MAX_FILES = 10;
const NAME_MAX = 200;
const THUMB_SIDE = 320;
const THUMB_MAX_CHARS = 60000;
/* 받아 둔 글 폴더를 최근 것부터 이만큼만 남깁니다. */
const KEEP_RECEIVED = 20;
const IS_WIN = process.platform === "win32";

/** OS 의 클립보드 형식 이름을 Electron 의 형식 이름으로 */
const osFormat = (name) => `electron application/osclipboard;format="${name}"`;

const maxBytes = (uid) => (uid === OWNER_UID ? 100 : 10) * MB;
const ID_RE = /^[-\w]{1,64}$/;

/** 사용자에게 그대로 보여 줄 메시지 */
class UserError extends Error {}

/* ---------- 이름과 종류 ---------- */
/** 모든 클라이언트가 같은 규칙으로 파일 이름을 다듬습니다. (docs/FILES.md "파일 이름 다듬기") */
function sanitizeName(raw) {
  let name = String(raw ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (name.length > NAME_MAX) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot < NAME_MAX ? name.slice(dot) : "";
    name = name.slice(0, NAME_MAX - ext.length) + ext;
  }
  return name || "file";
}

/** 이름 없는 그림(캡처를 그대로 복사한 경우): 이미지-YYYYMMDD-HHMMSS.png (로컬 시각) */
function imageName(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `이미지-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

const TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  bmp: "image/bmp", svg: "image/svg+xml", heic: "image/heic", heif: "image/heif", ico: "image/x-icon",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", md: "text/markdown", json: "application/json",
  html: "text/html", htm: "text/html", zip: "application/zip", "7z": "application/x-7z-compressed",
  hwp: "application/x-hwp", hwpx: "application/hwp+zip",
  doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm"
};

/** 확장자로 종류를 정합니다. 모르면 application/octet-stream */
function typeOf(name) {
  const m = /\.([^.]+)$/.exec(name);
  return (m && TYPES[m[1].toLowerCase()]) || "application/octet-stream";
}

const isImage = (type) => typeof type === "string" && type.startsWith("image/");

function formatMB(bytes) {
  return `${Math.round(bytes / MB)}MB`;
}

/* ---------- 미리보기 ---------- */
/** 투명한 부분을 흰 바탕으로 칠합니다. (JPEG 에는 투명이 없어 그대로 두면 검게 나옵니다) */
function onWhite(img) {
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();
  let changed = false;
  // toBitmap 은 알파를 미리 곱한(premultiplied) BGRA 라서, 흰 바탕과 합치면 색마다 (255 - 알파)를 더하면 됩니다.
  for (let i = 0; i < bmp.length; i += 4) {
    const a = bmp[i + 3];
    if (a === 255) continue;
    const add = 255 - a;
    bmp[i] += add; bmp[i + 1] += add; bmp[i + 2] += add; bmp[i + 3] = 255;
    changed = true;
  }
  return changed ? nativeImage.createFromBitmap(bmp, { width, height }) : img;
}

/** 첫 번째 그림의 미리보기: 긴 변 320px, JPEG 70%. 60,000자를 넘으면 품질을 낮추고, 그래도 크면 생략 */
function makeThumb(img) {
  if (!img || img.isEmpty()) return undefined;
  const { width, height } = img.getSize();
  if (!width || !height) return undefined;
  const scale = Math.min(1, THUMB_SIDE / Math.max(width, height));
  const small = scale < 1
    ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "good" })
    : img;
  const flat = onWhite(small);
  for (const quality of [70, 50, 30]) {
    const url = "data:image/jpeg;base64," + flat.toJPEG(quality).toString("base64");
    if (url.length <= THUMB_MAX_CHARS) return url;
  }
  return undefined;
}

/* ---------- PowerShell (Windows) ---------- */
/**
 * 스크립트는 -EncodedCommand(UTF-16LE base64)로 넘겨 따옴표가 꼬이지 않게 하고,
 * 파일 경로 같은 값은 환경 변수(JSON)로만 넘깁니다. 스크립트에 이름을 끼워 넣지 않습니다.
 */
function powershell(script, values) {
  const env = { ...process.env };
  if (values !== undefined) env.POSTIT_ARGS = JSON.stringify(values);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { env, windowsHide: true, timeout: 30_000, maxBuffer: 4 * MB, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr }));
        else resolve(stdout);
      });
  });
}

// 한글 이름이 깨지지 않도록 출력을 UTF-8 로 바꾼 뒤 한 줄에 경로 하나씩 씁니다.
const READ_FILE_LIST_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }
`;

// 파일 목록(탐색기에 붙이면 파일)과, 그림 한 장이면 그림(카톡·문서에 붙이면 그림)을 한 번에 올립니다.
const WRITE_FILE_LIST_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$req = $env:POSTIT_ARGS | ConvertFrom-Json
$list = New-Object System.Collections.Specialized.StringCollection
foreach ($p in $req.paths) { [void]$list.Add([string]$p) }
$data = New-Object System.Windows.Forms.DataObject
$data.SetFileDropList($list)
if ($req.image) {
  try {
    $bytes = [System.IO.File]::ReadAllBytes([string]$req.image)
    $stream = New-Object System.IO.MemoryStream (,$bytes)
    $data.SetImage([System.Drawing.Image]::FromStream($stream))
  } catch { }
}
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)
`;

/** 탐색기에서 복사한 파일·폴더 경로들. 없으면 빈 배열 */
async function readClipboardPaths(types) {
  if (!IS_WIN) return [];
  // 대개는 글자를 붙여넣으니, 파일이 있을 때만 PowerShell 을 띄웁니다.
  // (탐색기는 복사한 첫 파일 이름을 FileNameW 형식에도 둡니다)
  const hasFiles = types.includes("text/uri-list") || types.includes(osFormat("FileNameW")) ||
    await clipboard.has(osFormat("FileNameW"));
  if (!hasFiles) return [];
  const out = await powershell(READ_FILE_LIST_PS);
  return out.split(/\r?\n/).filter(Boolean);
}

/** 받아 둔 파일들을 클립보드에 올립니다. imagePath 가 있으면 그림으로도 붙여넣을 수 있게 합니다. */
async function writeClipboardPaths(paths, imagePath) {
  if (IS_WIN) {
    await powershell(WRITE_FILE_LIST_PS, { paths, image: imagePath || null });
    return;
  }
  // 위젯은 Windows 용입니다. 다른 OS 에서는 그림 한 장만 그림으로, 그 외에는 경로를 글자로 넣습니다.
  const img = imagePath ? nativeImage.createFromPath(imagePath) : null;
  if (img && !img.isEmpty()) {
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([img.toPNG()], { type: "image/png" }) })]);
  } else {
    await clipboard.writeText(paths.join("\n"));
  }
}

/* ---------- 클립보드 → 올릴 것 ---------- */
/**
 * 클립보드에서 올릴 것을 고릅니다.
 * - 파일(탐색기에서 복사) → { kind: "files", items, skipped }
 * - 그림(캡처) → { kind: "files", items: [png] }
 * - 글자 → { kind: "text", text } / 아무것도 없으면 { kind: "empty" }
 * 엑셀 셀처럼 글자와 그림이 함께 오는 경우는 글자로 봅니다(사용자는 글을 복사한 것이라서).
 */
/** 파일 경로들 → 올릴 것. 폴더는 건너뛰고 개수를 셉니다. (탐색기에서 복사했거나 끌어다 놓은 파일) */
async function itemsFromPaths(paths, uid) {
  const limit = maxBytes(uid);
  const items = [];
  let skipped = 0;
  for (const p of paths) {
    let st;
    try { st = await fs.promises.stat(p); } catch { throw new UserError("파일을 찾을 수 없습니다"); }
    if (st.isDirectory()) { skipped++; continue; }
    const name = sanitizeName(path.basename(p));
    if (st.size > limit) throw new UserError(`${name} 은(는) ${formatMB(limit)}를 넘어 올릴 수 없습니다`);
    items.push({ source: p, name, type: typeOf(name), size: st.size });
  }
  if (!items.length) throw new UserError("폴더는 올릴 수 없습니다. 파일을 골라 주세요");
  if (items.length > MAX_FILES) throw new UserError(`파일은 한 번에 ${MAX_FILES}개까지 올릴 수 있습니다`);
  return { kind: "files", items, skipped };
}

async function pickClipboard(uid) {
  const limit = maxBytes(uid);
  const entries = await clipboard.read();
  const types = entries.flatMap((entry) => entry.types);
  const paths = await readClipboardPaths(types);
  if (paths.length) return itemsFromPaths(paths, uid);

  const text = await clipboard.readText();
  const imageEntry = entries.find((entry) => entry.types.includes("image/png"));
  if (imageEntry && !text.trim()) {
    // 캡처(Windows 는 CF_DIB)도 Electron 이 PNG 로 바꿔 줍니다.
    const data = Buffer.from(await (await imageEntry.getType("image/png")).arrayBuffer());
    const image = nativeImage.createFromBuffer(data);
    if (!image.isEmpty()) {
      if (data.length > limit) throw new UserError(`그림이 ${formatMB(limit)}를 넘어 올릴 수 없습니다`);
      return { kind: "files", items: [{ data, image, name: imageName(), type: "image/png", size: data.length }], skipped: 0 };
    }
  }
  return text ? { kind: "text", text } : { kind: "empty" };
}

/* ---------- Storage 오류 → 알림 ---------- */
function failure(prefix, err) {
  if (err instanceof UserError) return err;
  console.error(err);
  if (err.status === 401 || err.status === 403) return new UserError(`${prefix}: 권한이 없습니다`);
  if (err.status === 404) return new UserError(`${prefix}: 서버에 파일이 없습니다`);
  if (err.status) return new UserError(`${prefix}: 서버 오류 (${err.status})`);
  return new UserError(`${prefix}: 인터넷 연결을 확인해 주세요`);
}

/** 위젯 화면에 돌려줄 실패 결과 */
function toFailure(err) {
  if (!(err instanceof UserError)) console.error(err);
  return { kind: "error", message: err instanceof UserError ? err.message : "처리하지 못했습니다: " + err.message };
}

/** 올린 파일을 지웁니다. (글 쓰기가 실패했을 때) 지우다 실패해도 무시합니다. */
async function discard(storage, { bucket, idToken, paths } = {}) {
  if (!Array.isArray(paths)) return false;
  for (const p of paths.slice(0, MAX_FILES)) {
    try { await storage.remove({ bucket, idToken }, p); } catch (err) { console.error("올린 파일 지우기 실패", err); }
  }
  return true;
}

/**
 * "클립보드 저장". 파일·그림이면 users/{uid}/{noteId}/{i}/{name} 에 올리고 { kind: "files", files, thumb } 를,
 * 글자면 { kind: "text", text } 를 돌려줍니다. 하나라도 못 올리면 앞서 올린 것을 지웁니다.
 */
async function saveClipboard(storage, { bucket, idToken, uid, noteId } = {}, onProgress = () => {}) {
  checkIds(uid, noteId);
  const picked = await pickClipboard(uid);
  if (picked.kind !== "files") return picked;
  return uploadPicked(storage, picked, { bucket, idToken, uid, noteId }, onProgress);
}

/** 위젯에 끌어다 놓은 파일들을 올립니다. 돌려주는 값은 saveClipboard 와 같습니다. */
async function saveDropped(storage, { bucket, idToken, uid, noteId, paths } = {}, onProgress = () => {}) {
  checkIds(uid, noteId);
  if (!Array.isArray(paths) || !paths.length || !paths.every((p) => typeof p === "string" && path.isAbsolute(p))) {
    throw new UserError("끌어다 놓은 파일을 읽지 못했습니다");
  }
  if (paths.length > MAX_FILES) throw new UserError(`파일은 한 번에 ${MAX_FILES}개까지 올릴 수 있습니다`);
  const picked = await itemsFromPaths(paths, uid);
  return uploadPicked(storage, picked, { bucket, idToken, uid, noteId }, onProgress);
}

function checkIds(uid, noteId) {
  if (typeof uid !== "string" || !ID_RE.test(uid) || typeof noteId !== "string" || !ID_RE.test(noteId)) {
    throw new Error("잘못된 요청");
  }
}

/** 고른 파일들을 users/{uid}/{noteId}/{i}/{name} 에 올리고 { kind: "files", files, thumb, skipped } 를 돌려줍니다. */
async function uploadPicked(storage, picked, { bucket, idToken, uid, noteId }, onProgress) {
  if (!idToken) throw new UserError("로그인 정보를 확인하지 못했습니다. 잠시 뒤 다시 해 주세요");

  const auth = { bucket, idToken };
  const total = picked.items.length;
  const files = [];
  try {
    for (const [i, item] of picked.items.entries()) {
      onProgress({ phase: "upload", done: i, total });
      const data = item.data || await fs.promises.readFile(item.source);
      // 고른 뒤에 파일이 커졌을 수도 있으니 한 번 더 봅니다.
      if (data.length > maxBytes(uid)) throw new UserError(`${item.name} 은(는) ${formatMB(maxBytes(uid))}를 넘어 올릴 수 없습니다`);
      const p = `users/${uid}/${noteId}/${i}/${item.name}`;
      await storage.upload(auth, p, data, item.type);
      files.push({ path: p, name: item.name, type: item.type, size: data.length });
    }
  } catch (err) {
    await discard(storage, { ...auth, paths: files.map((f) => f.path) });
    throw failure("올리기 실패", err);
  }
  onProgress({ phase: "upload", done: total, total });

  const first = picked.items.find((item) => isImage(item.type));
  let thumb;
  try {
    thumb = first && makeThumb(first.image || nativeImage.createFromPath(first.source));
  } catch (err) {
    console.error("미리보기 만들기 실패", err);
  }
  return { kind: "files", files, thumb, skipped: picked.skipped };
}

/* ---------- 파일 글 → 클립보드 ---------- */
const receivedRoot = () => path.join(app.getPath("userData"), "received");

/** 이 컴퓨터에 저장할 이름. 규약대로 다듬고, Windows 가 쓰지 못하게 막아 둔 이름(CON, NUL…)은 피합니다. */
function localName(name) {
  const safe = sanitizeName(name);
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe) ? "_" + safe : safe;
}

/** 최근에 쓴 글 폴더만 남기고 지웁니다. */
async function pruneReceived(keep = KEEP_RECEIVED) {
  const root = receivedRoot();
  let entries;
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return; }
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    try { dirs.push({ p, t: (await fs.promises.stat(p)).mtimeMs }); } catch {}
  }
  dirs.sort((a, b) => b.t - a.t);
  for (const { p } of dirs.slice(keep)) {
    await fs.promises.rm(p, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 파일 글의 "복사". received/{noteId}/{i}/{name} 에 받아 두고(같은 크기로 이미 있으면 다시 받지 않음)
 * 그 파일들을 클립보드에 올립니다. 그림 한 장이면 그림으로도 붙여넣을 수 있습니다.
 */
async function copyFiles(storage, { bucket, idToken, noteId, files } = {}, onProgress = () => {}) {
  if (typeof noteId !== "string" || !ID_RE.test(noteId) || !Array.isArray(files) || !files.length || files.length > MAX_FILES) {
    throw new Error("잘못된 요청");
  }
  const dir = path.join(receivedRoot(), noteId);
  const local = [];
  try {
    for (const [i, f] of files.entries()) {
      const target = path.join(dir, String(i), localName(f && f.name));
      const st = await fs.promises.stat(target).catch(() => null);
      if (!st || st.size !== f.size) {
        onProgress({ phase: "download", done: i, total: files.length });
        const data = await storage.download({ bucket, idToken }, f.path);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        // 받다 끊겨도 반쪽짜리 파일이 남지 않도록 임시 이름으로 받은 뒤 바꿉니다.
        const tmp = target + ".part";
        await fs.promises.writeFile(tmp, data);
        await fs.promises.rename(tmp, target);
      }
      local.push(target);
    }
  } catch (err) {
    throw failure("받기 실패", err);
  }
  onProgress({ phase: "download", done: files.length, total: files.length });

  // 방금 쓴 폴더를 최신으로 표시한 뒤 오래된 것을 정리합니다.
  const now = new Date();
  await fs.promises.utimes(dir, now, now).catch(() => {});
  await pruneReceived();

  const imagePath = files.length === 1 && isImage(files[0].type) ? local[0] : null;
  try {
    await writeClipboardPaths(local, imagePath);
  } catch (err) {
    console.error(err);
    throw new UserError("클립보드에 넣지 못했습니다");
  }
  return local;
}

module.exports = {
  saveClipboard, saveDropped, copyFiles, discard, toFailure,
  // 시험용
  sanitizeName, imageName, typeOf, makeThumb, pickClipboard, pruneReceived
};
