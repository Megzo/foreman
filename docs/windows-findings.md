# Phase 2: Windows reality check — findings

Go/no-go evidence for PRD Open Q1: does the Phase-1 stack work on **native
Windows 10/11** (not WSL) with the pinned codex binary?

- Machine: Windows 10 Pro, build **10.0.19045**, x86_64 (server string:
  `Windows 10.0.19045; x86_64`; remote-control serverName "Laptop")
- Codex CLI: pinned **0.138.0** — confirmed via `codex --version` →
  `codex-cli 0.138.0`. Toolchain: node v24.16.0, pnpm 11.5.3.
- Date run: **2026-06-12**
- Run by: Peter — signed in with a personal ChatGPT account (planType
  **free**). This checkpoint needs a real Windows machine; it cannot run in the
  WSL dev environment.

## Setup

```powershell
# in the repo root, native Windows (PowerShell), node + pnpm + codex 0.138.0 on PATH
pnpm install
# keep the dev machine's own ~/.codex out of the experiment:
$env:FOREMAN_CODEX_HOME = "$env:LOCALAPPDATA\foreman-windows-check"
```

## The five checks

Record pass/fail + raw output snippets for each. Any bug found here gets a
mock-peer regression test (CRLF splitting and the sandbox/login protocol
surface already have tests — see `packages/codex-adapter/src/codex.test.ts`)
**before** the fix, and the regression tests must stay green on Linux.

### 1. `pnpm foreman-dev auth-status`

Expect: JSON snapshot with `account: null` (fresh `CODEX_HOME`), exit 0.

- [x] **PASS** — `account: null`, `requiresOpenaiAuth: true`, exit 0:

  ```
  {
    "server": "foreman/0.138.0 (Windows 10.0.19045; x86_64) unknown (foreman; 0.0.1)",
    "account": null,
    "requiresOpenaiAuth": true
  }
  ```

  (One benign codex stderr warning on every spawn — see quirks note below.)

### 2. `pnpm foreman-dev login` (ChatGPT OAuth)

Expect: authUrl printed, browser sign-in completes, `account/login/completed`
arrives, signed-in `account/read` snapshot printed, exit 0.

- [x] **PASS** — authUrl printed, browser OAuth completed,
  `account/login/completed` arrived, exit 0:

  ```
  login completed
  {
    "account": {
      "type": "chatgpt",
      "email": "<redacted>",
      "planType": "free"
    },
    "requiresOpenaiAuth": true
  }
  ```

### 3. `pnpm foreman-dev sandbox-check`

Expect: `windowsSandbox/readiness` answers (`ready` / `notConfigured` /
`updateRequired`); if not ready, `setupStart` (unelevated) runs and readiness
becomes `ready`. Note whether elevation was required.

- [x] **PASS** — `windowsSandbox/readiness: ready` out of the box. No
  `setupStart` needed, **no elevation prompt**. This clears the #1 open risk —
  the native Windows sandbox path is live on this 10.0.19045 box.

  ```
  platform: windows (windows)
  windowsSandbox/readiness: ready
  ```

### 4. Sandboxed turn: `pnpm foreman-dev chat "Reply with exactly: SPIKE_OK"`

Expect: streamed deltas, `SPIKE_OK`, exit 0 (read-only sandbox).

- [x] **PASS** — streamed `SPIKE_OK`, exit 0. Worked on the free plan, and
  spawned `codex` with **no `CODEX_BIN` set** — i.e. the F-1 `resolveCodexBin()`
  fix resolved the npm `.cmd` shim → `codex.exe` correctly on the real machine.

### 5. Skill-invocation turn: `node spike-codex-app-server/probe.mjs`

Expect: the spike's full pass — `skills/list` discovers skills and the skill
turn streams to completion (same behavior verified on WSL 2026-06-11).

- [x] **PASS (with a known caveat — see F-3).** Run bare exactly as written, the
  probe ENOENTs at `spawn("codex")` because the spike is intentionally
  dependency-free and does **not** carry the F-1 `resolveCodexBin()` fix (only
  `codex.ts` does). Re-run with `CODEX_BIN` pointed at the absolute
  `codex.exe`, the full protocol passed: `initialize` → `account/read` (signed
  in) → `skills/list` (discovered the `imagegen` skill) → `thread/start` →
  `turn/start` → streamed `SPIKE_OK` → `turn/completed`. `PASS: yes`, exit 0.

  ```
  --- SPIKE RESULT ---
  streamed message: "SPIKE_OK"
  PASS: yes
  ```

  Note: `skills/list` echoes the requested cwd (`/home/megyo/projects/translate-book`,
  hardcoded Linux path in the probe) yet still returned a skill — discovery is
  not gated on that path existing on Windows.

## Verdict

- [x] **GO** — Windows-first stands. All five checks pass on native Windows
  10.0.19045 with the pinned codex 0.138.0. The native Windows sandbox is
  `ready` with no elevation, OAuth login works, and sandboxed + skill turns both
  stream to completion. Findings feed Phase 11 packaging (spawn the *bundled*
  codex.exe by absolute path — see F-1/F-3).
- [ ] **NO-GO** — per the plan, the OpenCode-adapter fallback decision
  escalates to Peter; it does not get made silently.

Notes / quirks observed (paths, quoting, console encoding, firewall prompts):

- **F-1 (2026-06-12, found during check 1):** `spawn("codex")` fails with
  ENOENT on win32 — npm installs `codex` as a `.cmd` shim, which PowerShell
  resolves but Node's spawn() does not (only `.exe` is auto-resolved). Worse,
  the unhandled spawn `error` event crashed the CLI process. Fixed per the
  regression-test-first rule: graceful spawn failure in `codex.ts` +
  `resolveCodexBin()` (PATH scan for `codex.exe`, then npm-shim → vendored
  `@openai/codex-win32-x64\vendor\...\bin\codex.exe`, layout verified on the
  real machine), table-driven tests green on Linux. `CODEX_BIN` still
  overrides everything. Phase 11 must spawn the *bundled* codex.exe by
  absolute path, which sidesteps this entirely.
- **F-2 (2026-06-12, found during check 1):** codex 0.138.0 on Windows exits 1
  at startup when `CODEX_HOME` points to a nonexistent directory (Linux runs
  never hit this because test homes came from `mkdtemp`). Fixed: the adapter
  now `mkdir -p`s `codexHome` before spawning — the shell owns that directory
  per FR-3.5. Regression test green on Linux. F-1's fix verified at the same
  time: codex.exe spawned natively with no `CODEX_BIN` set.
- **F-3 (2026-06-12, found during check 5):** the bare spike
  `spike-codex-app-server/probe.mjs` still ENOENTs at `spawn("codex")` on
  win32 — it predates and deliberately does not import the F-1
  `resolveCodexBin()` fix (the repo convention keeps spikes dependency-free, so
  this is left as-is). The *adapter* path (checks 1–4) is unaffected and spawns
  fine with no `CODEX_BIN`. Workaround for running the spike on Windows: set
  `CODEX_BIN` to the absolute `codex.exe`. No production code change — Phase 11
  spawns the bundled exe by absolute path anyway. No regression test added (the
  shipping `codex.ts` path already has F-1 coverage; the spike is not shipped).
- **Quirk — benign codex stderr on every spawn:** `WARNING: failed to clean up
  stale arg0 temp dirs: <os error 32>` (message localized to the machine's
  Hungarian system locale: "A folyamat nem fér hozzá a fájlhoz..."). Non-fatal;
  appears before normal output on all five checks; exit codes unaffected.
- **Env note:** on a fresh PowerShell session `node`/`pnpm`/`codex` were not on
  PATH until the registry PATH entries (`C:\Program Files\nodejs`,
  `%APPDATA%\npm`) were prepended. Machine config detail, not a stack issue.
- The vendored npm package also ships `codex-windows-sandbox-setup.exe` and
  `codex-command-runner.exe`. Correction to the F-1 note: these are **not**
  directly beside `codex.exe` — `codex.exe` lives in `...\vendor\
  x86_64-pc-windows-msvc\bin\`, while the two helpers are one level up in a
  sibling `...\vendor\x86_64-pc-windows-msvc\codex-resources\` folder. Phase 11
  bundling must copy both `bin\` and `codex-resources\` (codex.exe alone is not
  sufficient).
