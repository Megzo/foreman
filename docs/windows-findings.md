# Phase 2: Windows reality check — findings

Go/no-go evidence for PRD Open Q1: does the Phase-1 stack work on **native
Windows 10/11** (not WSL) with the pinned codex binary?

- Machine: _(fill in: Windows version, build, machine)_
- Codex CLI: pinned **0.138.0** — verify with `codex --version`
- Date run: _(fill in)_
- Run by: Peter (this checkpoint needs a real Windows machine; it cannot run
  in the WSL dev environment)

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

- [ ] pass / fail —

### 2. `pnpm foreman-dev login` (ChatGPT OAuth)

Expect: authUrl printed, browser sign-in completes, `account/login/completed`
arrives, signed-in `account/read` snapshot printed, exit 0.

- [ ] pass / fail —

### 3. `pnpm foreman-dev sandbox-check`

Expect: `windowsSandbox/readiness` answers (`ready` / `notConfigured` /
`updateRequired`); if not ready, `setupStart` (unelevated) runs and readiness
becomes `ready`. Note whether elevation was required.

- [ ] pass / fail —

### 4. Sandboxed turn: `pnpm foreman-dev chat "Reply with exactly: SPIKE_OK"`

Expect: streamed deltas, `SPIKE_OK`, exit 0 (read-only sandbox).

- [ ] pass / fail —

### 5. Skill-invocation turn: `node spike-codex-app-server/probe.mjs`

Expect: the spike's full pass — `skills/list` discovers skills and the skill
turn streams to completion (same behavior verified on WSL 2026-06-11).

- [ ] pass / fail —

## Verdict

- [ ] **GO** — Windows-first stands; findings feed Phase 11 packaging.
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
- The vendored npm package also ships `codex-windows-sandbox-setup.exe` and
  `codex-command-runner.exe` beside the main binary — note for Phase 11
  bundling (codex.exe alone may not be sufficient to copy).
