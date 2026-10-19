// Cloud Storage for Firebase — REST API 로 올리고, 받고, 지웁니다.
//
// 위젯 화면(file://)에서 Storage 를 부르면 CORS 에 막히므로, 메인 프로세스가 사용자의 ID 토큰을
// 받아 직접 부릅니다. 권한은 storage.rules 가 그 토큰으로 판단합니다. (경로 규칙은 docs/FILES.md)
const electron = require("electron");

const PROD_BASE = "https://firebasestorage.googleapis.com";
const EMULATOR_BASE = "http://127.0.0.1:9199";

// Electron 안에서는 Chromium 네트워크(시스템 프록시를 따름)를, 그냥 Node 로 돌릴 때는 기본 fetch 를 씁니다.
const doFetch = typeof electron === "object" && electron.net
  ? (url, init) => electron.net.fetch(url, init)
  : (url, init) => fetch(url, init);

/** Storage 가 거절한 요청. status 로 이유를 구분합니다. */
class StorageError extends Error {
  constructor(status, detail) {
    super(`Storage ${status}${detail ? ": " + detail : ""}`);
    this.status = status;
  }
}

function checkAuth({ bucket, idToken } = {}) {
  if (typeof bucket !== "string" || !/^[a-z0-9][a-z0-9._-]{0,220}$/i.test(bucket)) throw new Error("잘못된 버킷 이름");
  if (typeof idToken !== "string" || !idToken) throw new Error("로그인 토큰이 없습니다");
  return { bucket, idToken };
}

function checkPath(p) {
  if (typeof p !== "string" || !p.startsWith("users/") || p.length > 600) throw new Error("잘못된 파일 경로");
  return p;
}

/**
 * @param {{ emulator?: boolean, base?: string }} options base 는 에뮬레이터 포트를 바꿔 시험할 때만
 */
function createStorage({ emulator = false, base } = {}) {
  const root = base || (emulator ? EMULATOR_BASE : PROD_BASE);

  async function request(method, url, idToken, { body, type } = {}) {
    const headers = { Authorization: `Firebase ${idToken}` };
    if (type) headers["Content-Type"] = type;
    const res = await doFetch(url, { method, headers, body });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error.message || ""; } catch {}
      throw new StorageError(res.status, detail);
    }
    return res;
  }

  const objectUrl = (bucket, p) => `${root}/v0/b/${bucket}/o/${encodeURIComponent(checkPath(p))}`;

  return {
    /** 파일 하나를 올립니다. 같은 경로가 있으면 규칙이 거절합니다(덮어쓰기 금지). */
    async upload(auth, p, data, type) {
      const { bucket, idToken } = checkAuth(auth);
      const url = `${root}/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(checkPath(p))}`;
      const res = await request("POST", url, idToken, { body: data, type: type || "application/octet-stream" });
      return res.json();
    },

    /** 파일 내용을 Buffer 로 받습니다. */
    async download(auth, p) {
      const { bucket, idToken } = checkAuth(auth);
      const res = await request("GET", objectUrl(bucket, p) + "?alt=media", idToken);
      return Buffer.from(await res.arrayBuffer());
    },

    /** 파일을 지웁니다. 이미 없으면 지운 것으로 봅니다. */
    async remove(auth, p) {
      const { bucket, idToken } = checkAuth(auth);
      try {
        await request("DELETE", objectUrl(bucket, p), idToken);
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
  };
}

module.exports = { createStorage, StorageError };
