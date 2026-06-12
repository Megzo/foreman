import type { ShellApi } from "@foreman/shell-main/ipc";

declare global {
  interface Window {
    /** Exposed by the preload bridge (packages/shell-main/src/preload.ts). */
    foreman: ShellApi;
  }
}

export {};
