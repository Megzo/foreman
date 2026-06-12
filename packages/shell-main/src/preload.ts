import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AuthState, ShellApi, TaskEvent } from "./ipc.js";

/**
 * The only bridge between renderer and main: implements ShellApi over IPC and
 * exposes it as window.foreman. The renderer never sees Node or Electron.
 */
const api: ShellApi = {
  getBootState: () => ipcRenderer.invoke("shell:getBootState"),
  onAuthState(handler) {
    const listener = (_event: IpcRendererEvent, state: AuthState) => handler(state);
    ipcRenderer.on("shell:authState", listener);
    // Replay the current state so late subscribers render instantly.
    void ipcRenderer.invoke("shell:getAuthState").then((state: AuthState) => handler(state));
    return () => {
      ipcRenderer.removeListener("shell:authState", listener);
    };
  },
  startLogin: (type) => ipcRenderer.invoke("shell:startLogin", type),
  cancelLogin: () => ipcRenderer.invoke("shell:cancelLogin"),
  logout: () => ipcRenderer.invoke("shell:logout"),
  launchTask: (taskId, params) => ipcRenderer.invoke("shell:launchTask", taskId, params),
  onTaskEvent(handler) {
    const listener = (_event: IpcRendererEvent, event: TaskEvent) => handler(event);
    ipcRenderer.on("shell:taskEvent", listener);
    return () => {
      ipcRenderer.removeListener("shell:taskEvent", listener);
    };
  },
  pickFile: (extensions) => ipcRenderer.invoke("shell:pickFile", extensions),
};

contextBridge.exposeInMainWorld("foreman", api);
