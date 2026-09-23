// 렌더러와 로그인 페이지를 dist/ 로 묶습니다. (Firebase SDK 를 앱 안에 넣어 CDN 없이 뜨게)
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: { widget: "src/renderer/widget.js", login: "src/login/login.js" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "none",
  logLevel: "info"
});
await copyFile("src/login/login.html", "dist/login.html");
