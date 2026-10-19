// 위젯 화면이 쓸 수 있는 기능만 좁게 열어 둡니다.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const on = (channel) => (callback) => {
  const listener = (_e, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("postit", {
  env: () => ipcRenderer.invoke("env:get"),
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  // 클립보드 → 새 글. 파일·그림이면 올린 뒤 { kind: "files", files, thumb } 를 돌려줍니다.
  saveClipboard: (req) => ipcRenderer.invoke("clip:save", req),
  // 위젯에 끌어다 놓은 파일 → 올리기. 경로는 webUtils 로만 얻습니다(화면은 경로를 모릅니다).
  saveDropped: (req, files) =>
    ipcRenderer.invoke("files:save-dropped", { ...req, paths: Array.from(files, (f) => webUtils.getPathForFile(f)) }),
  // 글 쓰기가 실패했을 때 방금 올린 파일 지우기
  discardUploads: (req) => ipcRenderer.invoke("clip:discard", req),
  // 파일 글 → 받아서 클립보드로
  copyFiles: (req) => ipcRenderer.invoke("files:copy", req),
  hide: () => ipcRenderer.invoke("widget:hide"),
  setCollapsed: (collapsed) => ipcRenderer.invoke("widget:set-collapsed", collapsed),
  openWeb: () => ipcRenderer.invoke("app:open-web"),
  startLogin: () => ipcRenderer.invoke("auth:start"),
  onHover: on("widget:hover"),
  onFileProgress: on("files:progress"),
  onCredential: on("auth:credential"),
  onSignOutRequest: on("auth:signout")
});
