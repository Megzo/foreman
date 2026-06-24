import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AuthState, ShellApi, TaskEvent, UserInputRequestPayload } from "./ipc.js";

/**
 * The only bridge between renderer and main: implements ShellApi over IPC and
 * exposes it as window.foreman. The renderer never sees Node or Electron.
 */
const api: ShellApi = {
  getBootState: () => ipcRenderer.invoke("shell:getBootState"),
  getSettings: () => ipcRenderer.invoke("shell:getSettings"),
  setLocale: (locale) => ipcRenderer.invoke("shell:setLocale", locale),
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
  sendChat: (text) => ipcRenderer.invoke("shell:sendChat", text),
  cancelTask: () => ipcRenderer.invoke("shell:cancelTask"),
  onUserInputRequest(handler) {
    const listener = (_event: IpcRendererEvent, request: UserInputRequestPayload) =>
      handler(request);
    ipcRenderer.on("shell:userInputRequest", listener);
    return () => {
      ipcRenderer.removeListener("shell:userInputRequest", listener);
    };
  },
  answerUserInput: (requestId, answers) =>
    ipcRenderer.invoke("shell:answerUserInput", requestId, answers),
  pickFile: (extensions) => ipcRenderer.invoke("shell:pickFile", extensions),
  listRuns: () => ipcRenderer.invoke("shell:listRuns"),
  findResumable: () => ipcRenderer.invoke("shell:findResumable"),
  resumeRun: (runId) => ipcRenderer.invoke("shell:resumeRun", runId),
  dismissResume: (runId) => ipcRenderer.invoke("shell:dismissResume", runId),
  restartAgent: () => ipcRenderer.invoke("shell:restartAgent"),
  openOutputDir: (dir) => ipcRenderer.invoke("shell:openOutputDir", dir),
};

contextBridge.exposeInMainWorld("foreman", api);
