// 로그인용 로컬 서버.
//
// Google 은 앱에 내장된 브라우저에서의 로그인을 막으므로, 기본 브라우저로
// http://localhost:{port}/login 을 엽니다. `localhost` 는 Firebase 가 기본으로 허용하는
// 도메인이라 웹앱과 같은 팝업 로그인이 그대로 됩니다. 로그인이 끝나면 페이지가
// Google ID 토큰을 이 서버로 돌려주고, 위젯이 그것으로 Firebase 에 로그인합니다.
//
// 다른 웹페이지나 프로그램이 자기 토큰을 끼워 넣지 못하도록(로그인 CSRF),
// Host / Origin / Content-Type 과 이번 로그인에만 쓰는 state 값을 모두 확인합니다.
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DIST = path.join(__dirname, "..", "dist");
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BODY = 64 * 1024;
const STATE_RE = /^[0-9a-f]{48}$/;
// IPv6 가 아예 없는 PC 에서 나는 오류. 이때는 IPv4 하나로 충분합니다.
const NO_IPV6 = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

async function startLoginServer({ emulator, onCredential }) {
  const state = crypto.randomBytes(24).toString("hex");
  const servers = [];
  let port = 0;
  let done = false;

  const allowedHosts = () => new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);

  const html = () => fs.readFileSync(path.join(DIST, "login.html"), "utf8")
    .replace("/*BOOT*/null", JSON.stringify({ state, emulator }).replace(/</g, "\\u003c"));

  function reply(res, status, body, type = "application/json") {
    res.writeHead(status, { "Content-Type": type });
    res.end(body);
  }

  function handleCallback(req, res) {
    const origin = req.headers.origin;
    const type = String(req.headers["content-type"] || "");
    if (origin !== `http://localhost:${port}` || !type.startsWith("application/json")) {
      req.resume();
      return reply(res, 403, JSON.stringify({ ok: false }));
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const valid = !done &&
          data && typeof data.state === "string" && STATE_RE.test(data.state) &&
          crypto.timingSafeEqual(Buffer.from(data.state), Buffer.from(state)) &&
          typeof data.idToken === "string" && data.idToken.length > 0 && data.idToken.length < 16384;
        if (!valid) return reply(res, 400, JSON.stringify({ ok: false }));

        done = true;
        reply(res, 200, JSON.stringify({ ok: true }));
        onCredential({ idToken: data.idToken });
        setTimeout(close, 1000);
      } catch {
        reply(res, 400, JSON.stringify({ ok: false }));
      }
    });
  }

  function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    // DNS 리바인딩으로 다른 사이트 이름을 달고 들어오는 요청을 막습니다.
    if (!allowedHosts().has(req.headers.host)) return reply(res, 403, "", "text/plain");

    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/login") {
      return reply(res, 200, html(), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/login.js") {
      return reply(res, 200, fs.readFileSync(path.join(DIST, "login.js")), "text/javascript; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/callback") return handleCallback(req, res);
    reply(res, 404, "", "text/plain");
  }

  function close() {
    clearTimeout(timer);
    for (const s of servers) s.close();
  }

  // 루프백에만 엽니다. 브라우저가 localhost 를 ::1 로 먼저 찾아가는 경우를 위해 같은 포트로
  // IPv6 도 엽니다. 그 포트의 ::1 을 다른 프로그램이 쥐고 있으면 다른 포트로 다시 시도합니다.
  for (let attempt = 0; attempt < 5 && servers.length === 0; attempt++) {
    const v4 = http.createServer(handler);
    port = await listen(v4, 0, "127.0.0.1");
    const v6 = http.createServer(handler);
    try {
      await listen(v6, port, "::1");
      servers.push(v4, v6);
    } catch (err) {
      if (NO_IPV6.has(err.code)) servers.push(v4);
      else v4.close();
    }
  }
  if (servers.length === 0) throw new Error("로그인용 로컬 포트를 열지 못했습니다.");

  const timer = setTimeout(close, TIMEOUT_MS);
  let closed = false;
  servers[0].on("close", () => { closed = true; });
  return {
    url: `http://localhost:${port}/login`,
    port,
    close,
    get closed() { return closed; }
  };
}

module.exports = { startLoginServer };
