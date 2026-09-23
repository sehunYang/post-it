// 위젯 화면이 쓸 수 있는 기능만 좁게 열어 둡니다.
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (callback) => {
  const listener = (_e, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("postit", {
  env: () => ipcRenderer.invoke("env:get"),
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  hide: () => ipcRenderer.invoke("widget:hide"),
  openWeb: () => ipcRenderer.invoke("app:open-web"),
  startLogin: () => ipcRenderer.invoke("auth:start"),
  onHover: on("widget:hover"),
  onCredential: on("auth:credential"),
  onSignOutRequest: on("auth:signout")
});
