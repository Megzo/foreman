# Implementation Plan: Foreman v1 — Vertical Agent App Shell + Translate-Book App

Source of truth: `PRD.md` (requirements, FR numbers referenced below) and `CLAUDE.md` (decisions, protocol facts). Reference-only code: `t3code/` (never modified), `spike-codex-app-server/probe.mjs` (proven protocol client to port).

## Strategy

Every phase is a tracer bullet: a thin end-to-end path from an observable behavior down through whatever layers it needs, verified before the next phase starts. We never build "all of the adapter", "all of the UI", or "tests at the end" — each phase adds one behavior a human (or the dev CLI) can see working, with its tests written first.

The riskiest unknowns get the earliest bullets: the Codex protocol (Phase 1, headless — already de-risked by the spike, now hardened into a tested adapter) and Codex-on-native-Windows (Phase 2, a manual checkpoint that can run in parallel with Phases 3–5 but gates packaging). The Electron app exists from Phase 3 and **stays launchable at the end of every phase thereafter** — `pnpm dev` must always boot to a working screen.

TDD shape: red-green at the public-interface level. Unit/integration tests use **vitest with co-located `*.test.ts` files** (the same convention as t3code, minus Effect.ts). The protocol is tested against a **scripted mock app-server peer** (plain Node child process speaking JSONL — pattern borrowed from `t3code/.../test/fixtures/codex-app-server-mock-peer.ts`, reimplemented without Effect). A separate **smoke tier** (`pnpm smoke`) drives the real pinned `codex` binary and is run locally at each phase boundary, not in CI. Renderer flows get component tests (vitest + @testing-library/react) and, from Phase 4 on, a small Playwright-Electron E2E suite (`pnpm e2e`).

Public interfaces under test (keep these stable; test nothing below them):
`AgentAdapter` (events + methods), `ManifestLoader.load()`, `PolicyEngine.decide()`, `WorkspaceProvisioner.provision()`, `SessionStore` (run lifecycle), the main↔renderer IPC contract, the dev CLI, and rendered widget behavior.

Repo layout (PRD Open Q7): pnpm workspace in this directory, beside `t3code/` (git-ignored or submodule). Packages: `packages/codex-adapter`, `packages/shell-main`, `packages/shell-renderer`, `packages/app-bundle-tools`, `apps/translate-book`, `apps/echo-demo`.

---

## Phase 1: Headless adapter tracer bullet (`foreman-dev chat`) — ✅ COMPLETE (2026-06-11)

> Done: `packages/codex-adapter` (rpc/types/events/adapter/codex + mock-peer fixture, 13 tests), `tools/foreman-dev.ts`. Verified: `pnpm test`, `pnpm typecheck`, `pnpm build` green; `pnpm foreman-dev chat "Reply with exactly: SPIKE_OK"` printed SPIKE_OK and exited 0 on real codex 0.138.0; `auth-status` works. Carry-forward: verify approval decision wire values ("accept"/"decline" per schema.gen.ts vs PRD's "approved"/"denied") before Phase 5.

**Goal:** From a terminal, `pnpm foreman-dev chat "Reply with exactly: SPIKE_OK"` spawns the pinned codex binary, completes the handshake, runs a turn, streams deltas live to stdout, and exits 0 on `turn/completed` — the spike, reborn as a typed, tested package.

**Scope:** pnpm workspace + TS + vitest scaffolding; `packages/codex-adapter`: JSONL JSON-RPC client (request/notify/server-request dispatch, request-id correlation), `AgentAdapter` interface (lifecycle, auth-read, thread/turn methods, typed event emitter, server-request callbacks — FR-2.1), `CodexAdapter` implementation (handshake per FR-2.3, spawn/supervise, `CODEX_HOME` override per FR-3.5), protocol types hand-derived from `t3code/.../schema.gen.ts` for only the messages we use; the mock-peer test fixture; the dev CLI.

**Out of scope:** Electron, any UI, login flows beyond `account/read`, policy logic (CLI auto-denies approvals), skills, persistence.

**Likely code areas:** new `package.json`/`pnpm-workspace.yaml`/`tsconfig`; `packages/codex-adapter/src/{rpc,adapter,codex,types,events}.ts`; `packages/codex-adapter/test/fixtures/mock-peer.ts`; `packages/codex-adapter/src/*.test.ts`; `tools/foreman-dev.ts`. Port logic from `spike-codex-app-server/probe.mjs`.

**Tests first:**
- Mock-peer: handshake sends `initialize` (with `experimentalApi: true`) before anything else, then `initialized`; out-of-order use rejects.
- Request/response correlation under interleaved responses; error responses reject with method name.
- Delta ordering: scripted `item/agentMessage/delta` sequence is emitted in order and concatenates to the full message.
- Server-request round-trip: mock sends `item/commandExecution/requestApproval`; registered callback's value is sent back as the JSON-RPC response with the same id.
- Process death mid-turn emits a terminal error event (FR-2.5, detection half).
- Unparseable line is logged and skipped without killing the connection.

**Implementation notes:** Smallest thing that passes: a line-buffered stdio transport + Map of pending requests + EventEmitter, mirroring the spike. No retries, no reconnect, no Effect.ts. Pin codex 0.138.0; log version mismatch from `initialize` result (FR-2.6).

**Verification:** `pnpm test` green; `pnpm foreman-dev chat "Reply with exactly: SPIKE_OK"` prints SPIKE_OK and exits 0; `pnpm foreman-dev auth-status` prints the `account/read` snapshot.

**Dependencies:** none.

---

## Phase 2: Windows reality check (manual checkpoint, user-assisted) — ✅ COMPLETE (tooling 2026-06-11; **real-Windows go/no-go run 2026-06-12 → GO**)

> Done: `foreman-dev login` + `sandbox-check` commands; adapter `startLogin`/`windowsSandboxReadiness`/`windowsSandboxSetupStart` + `loginCompleted`/`windowsSandboxSetupCompleted` events (5 new mock-peer tests incl. CRLF wire guard); `docs/windows-findings.md` checklist. Verified on Linux: real-codex `login` prints a live authUrl; `sandbox-check` probes readiness and fails setup with the expected "only supported on Windows".
>
> **Real-Windows run complete (2026-06-12) — resolves PRD Open Q1, verdict GO.** All five checks passed on native Windows 10.0.19045 with pinned codex 0.138.0 (signed in as Peter, free plan): `auth-status` (account null), browser OAuth `login`, `sandbox-check` → `windowsSandbox/readiness: ready` **with no setup and no elevation** (the #1 open risk, now cleared), a sandboxed `SPIKE_OK` turn, and the skill-invocation probe (full protocol incl. `skills/list`). Evidence recorded in `docs/windows-findings.md`. Windows-specific findings fixed under the regression-test-first rule: F-1 (`spawn("codex")` ENOENT — npm `.cmd` shim → `resolveCodexBin()`, confirmed working on the real machine with no `CODEX_BIN` set) and F-2 (`mkdir -p` the `CODEX_HOME` dir before spawn). F-3 (the bare `probe.mjs` spike has no F-1 fix and needs `CODEX_BIN`=absolute `codex.exe`) is a spike-only quirk, not shipped code. The OpenCode-fallback escalation is **moot** — Windows-first stands. Phase 11 still owns packaging/bundling (spawn the bundled `codex.exe` by absolute path; copy both `bin\` and `codex-resources\`).

**Goal:** Go/no-go evidence for PRD Open Q1: the Phase-1 CLI works on native Windows 10/11 with the pinned codex binary, including sandbox setup and login.

**Scope:** Run `foreman-dev` on a real Windows machine/VM: `auth-status`, chatgpt login (`foreman-dev login` — add this thin command: `account/login/start`, print authUrl, await completed), `windowsSandbox/readiness` probe + `setupStart` if needed, a sandboxed turn, and a skill-invocation turn. Record findings in `docs/windows-findings.md`.

**Out of scope:** Packaging, installers, bundling Python/Calibre (that's Phase 11). Fixing Windows-specific adapter bugs is IN scope (that's the point).

**Likely code areas:** `tools/foreman-dev.ts` (add `login`, `sandbox-check` commands); possibly `packages/codex-adapter/src/codex.ts` (spawn/path quirks on win32).

**Tests first:** This phase is a manual checkpoint, not TDD — but any Windows-specific bug found gets a regression test against the mock peer (e.g. CRLF line splitting, path quoting) before the fix.

**Implementation notes:** Needs Peter's Windows machine; cannot run in this WSL environment. Schedule it as soon as Phase 1 lands; Phases 3–5 may proceed in parallel. If natively broken: per PRD, pull the OpenCode adapter forward — that decision escalates to Peter, it does not get made silently.

**Verification:** All five checks recorded in `docs/windows-findings.md` with pass/fail + notes; CRLF/path regression tests (if any) green on Linux too.

**Dependencies:** Phase 1.

---

## Phase 3: Electron skeleton — manifest, branded login, home screen — ✅ COMPLETE (2026-06-12)

> Done: `packages/shell-main` (`ManifestLoader` with field-naming validation, `codexHomePath`, `AuthController`, Electron `main.ts` + `preload.ts` typed-IPC bridge implementing `ShellApi` from `src/ipc.ts`), `packages/shell-renderer` (App screen state machine, Login incl. device-code fallback + failure/retry, Home with launcher card + settings/logout, StartupError; hu strings through the `t()` stub), `apps/echo-demo/manifest.json`. Adapter gained `logout()`/`cancelLogin()` (schema-verified shapes; mock-peer `signed-out` scenario added). Electron + electron-vite; `pnpm dev` (real codex) and `pnpm dev:mock` (mock peer, offline). 43 tests green; `pnpm typecheck`/`build`/`smoke` green. Verified live on WSLg via CDP: branded login → click → mock OAuth completes → home with launcher card; broken manifest boots to the error screen naming `tasks[0].skill`. Carry-forward: the real-codex browser login → home walk-through needs Peter at a browser (mock-peer path proven; `foreman-dev login` already proved real OAuth on Windows in Phase 2).

**Goal:** `pnpm dev` opens a branded window: app icon/name/colors from a manifest; if signed out, a login screen whose button opens the ChatGPT authUrl in the system browser and which advances to the home screen on `account/login/completed`; home shows the manifest's task launcher card (visible, not yet functional) and the signed-in account in a settings menu.

**Scope:** `packages/shell-main` (Electron main: boot, `ManifestLoader` + JSON-schema validation with field-naming startup errors per FR-1.1/1.2, adapter ownership, typed IPC bridge), `packages/shell-renderer` (React: login screen incl. device-code fallback per FR-3.2/3.3, home screen, error screen, settings menu with logout per FR-3.4), `apps/echo-demo` (a minimal manifest used as the dev fixture — this becomes the PRD's "second toy manifest" acceptance asset).

**Out of scope:** Launching tasks, forms, chat, policy, provisioning, sessions, i18n plumbing (hardcode Hungarian strings in components for now, but route them through one `t()` stub so Phase 9 is mechanical).

**Likely code areas:** `packages/shell-main/src/{main,manifest,ipc,adapter-host}.ts`; `packages/shell-renderer/src/{App,screens/Login,screens/Home,screens/StartupError}.tsx`; `apps/echo-demo/manifest.json`; preload script with the typed IPC contract.

**Tests first:**
- `ManifestLoader`: valid echo-demo manifest loads; missing `tasks[0].skill`, bad color format, unknown schema version each produce an error naming the field (FR-1.2, PRD acceptance item).
- IPC contract: renderer-side client receives a scripted auth-state sequence (signed-out → pending → signed-in) and the screen-level state machine follows (component test).
- Login screen component: renders both flows; device-code state shows userCode + verificationUrl; failure state offers retry.
- Main-process unit: `CODEX_HOME` is set under app-data, never the user's `~/.codex` (FR-3.5).

**Implementation notes:** Electron + Vite + React. The adapter from Phase 1 runs in the main process; the renderer only ever sees the IPC contract — design it event-streamy now (it is the seam everything later rides on). Mock-peer can stand in for codex in dev (`FOREMAN_MOCK_PEER=1`) so UI work doesn't burn tokens.

**Verification:** `pnpm test` green; `pnpm dev` with a broken manifest shows the field-naming error screen; with echo-demo manifest and real codex: log out, log back in via browser, land on home (manual); `pnpm dev` with mock peer boots fully offline.

**Dependencies:** Phase 1. (Phase 2 not required.)

---

## Phase 4: First task end-to-end (echo-demo)

**Goal:** Clicking echo-demo's launcher renders a parameter form from the manifest, and submitting it runs a real skill-invoking turn: workspace gets provisioned, the skill is discovered, agent output streams into the running view, and the run ends in a success state. The PRD's core tracer bullet.

**Scope:** Param-form renderer from manifest field schemas (FR-1.3, the five field types incl. file picker); minimal `WorkspaceProvisioner` (create hidden workspace, copy skill files into the `CODEX_HOME` skills dir per Open Q3, write a provisioning-state file — FR-6.1, versioning deferred); task launch path: `thread/start` (workspace cwd, manifest sandbox) → `turn/start` with `{type:"skill"}` + params text (FR-4.1); running view (status line, activity feed of item events, streamed message — reasoning collapsed per FR-4.7); terminal states success/failed (FR-4.6, cancel comes in Phase 6); echo-demo gets a real trivial SKILL.md ("write params to result.txt and reply done").

**Out of scope:** Policy engine (temporary hardcoded auto-deny stays), chat input, requestUserInput modal, cancel, sessions/history/resume, outputs-to-Documents, progress percentages.

**Likely code areas:** `packages/shell-renderer/src/widgets/{ParamForm,ActivityFeed,RunView}.tsx`; `packages/shell-main/src/{workspace,task-runner}.ts`; `apps/echo-demo/skill/SKILL.md`; IPC additions (launch, event stream, terminal state).

**Tests first:**
- ParamForm component: renders each field type from schema; required-field gap disables submit with inline hint; submit emits typed params (FR-1.3, UX requirement).
- TaskRunner against mock peer: launch produces `thread/start` then `turn/start` whose input contains the skill reference and params text, in order (FR-4.1); scripted turn ending in error yields `failed`, normal end yields `success` (FR-4.6).
- WorkspaceProvisioner: fresh provision copies skill files to the expected path; second run is a no-op (idempotence, FR-6.2 minimal).
- Playwright-Electron (first E2E, mock peer): launch app → click launcher → fill form → submit → see streamed text → success state.

**Implementation notes:** Smallest task-runner: one active run at a time, in-memory state. Activity feed maps item types to canned human-readable lines — no raw commands shown (UX requirement). Real-codex smoke: run echo-demo end-to-end once per phase boundary from here on.

**Verification:** `pnpm test` + `pnpm e2e` green; manual: `pnpm dev`, run echo task against real codex, `result.txt` appears in the workspace and success state shows.

**Dependencies:** Phase 3.

---

## Phase 5: Policy engine — baked approvals, friendly denials

**Goal:** Approval requests are answered from the manifest policy with no dialog ever shown; a deliberately out-of-policy command is denied and appears in the activity feed as a friendly message while the run continues (PRD acceptance item).

**Scope:** `PolicyEngine.decide(policy, request)` (FR-5.1/5.2: sandbox mode passthrough, command-pattern allowlist → `"approved"`/`"approved_for_session"`, default `"denied"` — never `"abort"` per FR-5.3); wire as the adapter's approval callbacks for both command and fileChange requests; denial events render in the feed with localized text; decision logging (FR-5.4); echo-demo manifest gets a real policy block.

**Out of scope:** Network-policy amendments, execpolicy amendments (respond with plain decisions only), policy editing UI (never in scope).

**Likely code areas:** `packages/shell-main/src/policy.ts` (+ test); manifest schema extension (`ManifestLoader`); `task-runner` wiring; `ActivityFeed` denial rendering; log module.

**Tests first:**
- Table-driven `PolicyEngine.decide()`: allowlist hit → approved; session-cached pattern → approved_for_session; miss → denied; fileChange inside workspace per policy flag; malformed request → denied (fail closed). Assert exact protocol response values (FR-5 contract).
- Mock-peer integration: scripted approval request mid-turn gets the policy answer and the turn proceeds; denial emits a feed event.
- Log test: each decision appends request, matched rule, decision (FR-5.4).

**Implementation notes:** Patterns as anchored argv-prefix matchers (not regex strings in v1 — simpler to audit). Hostile-prompt manual test: ask echo-demo to `curl example.com`; expect friendly denial, no hang.

**Verification:** `pnpm test` green; manual hostile-prompt check against real codex passes; log file shows the decision trail.

**Dependencies:** Phase 4.

---

## Phase 6: In-task chat, requestUserInput modal, cancel

**Goal:** During a run the user can type into the task-scoped chat and see the agent react (steer); `item/tool/requestUserInput` pops a native form whose answers reach the skill; cancel (with confirmation) interrupts the turn and lands in the cancelled state.

**Scope:** Chat input pane wired to `turn/steer` when a turn is in progress, `turn/start` when idle (FR-4.3); requestUserInput modal (radio/checkbox/free-text per FR-4.4) returning protocol-shaped answers; cancel → confirm dialog → `turn/interrupt` → cancelled terminal state (FR-4.5/4.6); resolve PRD Open Q4 (steer reliability) empirically — if unreliable, implement the documented queue-fallback.

**Out of scope:** Chat history persistence (Phase 7), follow-up chat after success (comes free, verify only).

**Likely code areas:** `packages/shell-renderer/src/widgets/{ChatPane,UserInputModal,ConfirmDialog}.tsx`; `task-runner` (steer/idle routing, interrupt); echo-demo skill extended with an AskUserQuestion step (test asset).

**Tests first:**
- Routing unit: message during in-progress turn → `turn/steer`; when idle → `turn/start` (mock peer asserts methods).
- UserInputModal component: questions with options render as choices, answer payload matches `{answers: {id: {answers: [...]}}}` shape; no-options question gives free text.
- Mock-peer integration: scripted requestUserInput is answered with the modal's value; scripted interrupt sequence ends run as `cancelled`.
- E2E (mock peer): type chat mid-run, see it appear; cancel flow reaches cancelled state.

**Implementation notes:** Keep one chat transcript per run in memory (renderer state) — persistence is next phase. Real-codex steer experiment goes in `docs/` notes; queue-fallback only if needed.

**Verification:** `pnpm test` + `pnpm e2e` green; manual: real-codex echo run, steer mid-run, answer a skill question via modal, cancel a fresh run.

**Dependencies:** Phase 4 (Phase 5 recommended first so manual runs are policy-clean).

---

## Phase 7: Sessions, history, resume, crash recovery

**Goal:** Runs survive restarts: a history list on home shows past runs with status; killing the app mid-run and relaunching offers "Folytatás", which resumes via `thread/resume`; killing the codex process shows the restart banner and one-click resume works (two PRD acceptance items).

**Scope:** `SessionStore` (SQLite index of runs + JSONL transcript per run, per PRD State section; FR-7.1); task-runner records lifecycle + transcript; startup in-progress detection → resume offer (FR-7.2); `thread/resume` path in adapter (exists from Phase 1 interface — now exercised); codex-death banner + restart/resume (FR-2.5 UI half); history screen with output links (FR-7.3, links functional after Phase 8).

**Out of scope:** Skill-level resume smartness (translate-book's `run_state.json` handles that itself — Phase 8 verifies), migrations beyond schema-version stamping.

**Likely code areas:** `packages/shell-main/src/{session-store,task-runner}.ts`; `packages/shell-renderer/src/screens/{Home,RunView}.tsx` (history, resume offer, banner); `session-store.test.ts`.

**Tests first:**
- SessionStore: create→update→complete persists across a simulated restart (new store on same dir); in-progress run is reported as resumable with its thread id; transcript JSONL replays in order.
- Task-runner integration (mock peer): resume calls `thread/resume` with the stored id, then continues streaming into the same run record.
- Adapter: process-death event → restart() → resume succeeds against a relaunched mock peer.
- E2E (mock peer): kill window mid-run, relaunch, resume offer appears, accepting continues to success; history row appears.

**Implementation notes:** better-sqlite3 for the index; schema_version columns from day one (PRD State). Keep store API run-centric (`createRun/appendEvent/finishRun/listRuns/findResumable`) — that's the public interface, the SQL is not.

**Verification:** `pnpm test` + `pnpm e2e` green; manual: real-codex run, `kill -9` the codex pid → banner → resume; quit app mid-run → relaunch → resume.

**Dependencies:** Phases 4, 6.

---

## Phase 8: The real app — Translate-Book end-to-end (dev mode)

**Goal:** On Linux/macOS dev mode with system python/pandoc/Calibre, the Translate-Book app translates a baseline book end-to-end: file picker → options form → live "chunk N of M" progress → success with outputs in `Documents/<AppName>/<job>/` and a working "Open folder" button.

**Scope:** `apps/translate-book` manifest (task, form fields per PRD UX, FR-5.5 policy: workspace-write, network off, python3/pandoc/ebook-convert allowlist); vendor a pinned copy of the skill from `/home/megyo/projects/translate-book` (sync script, that repo stays source of truth); progress: add the backward-compatible `progress.json` convention to the skill (PRD Open Q2) + shell file-watcher mapping to the progress bar, with item-event fallback; outputs copy to Documents on success (FR-6.3); provisioner versioning completed (FR-6.2: bundle-version bump re-provisions managed files, user files survive); binary health check (presence of python3/pandoc/ebook-convert with friendly failure — FR per Integration section); resolve PRD Open Q5 (sub-agent parallelism) empirically and document.

**Out of scope:** Windows packaging/bundled binaries (Phase 11), glossary/SUMMARY editing UI (not in v1 PRD), update channels.

**Likely code areas:** `apps/translate-book/{manifest.json,skill/,sync-skill.sh}`; `packages/shell-main/src/{workspace,outputs,binary-health,progress-watch}.ts`; `RunView` progress bar; a PR-sized change in `/home/megyo/projects/translate-book` (progress.json emission — separate repo, coordinate, keep optional).

**Tests first:**
- Provisioner versioning: bump bundle version → managed files refreshed, a user-created file in the workspace untouched (FR-6.2).
- Progress watcher: scripted progress.json writes → ordered progress events; malformed file ignored (fail-soft).
- Outputs module: completion definition (glob in manifest) → files copied (not moved) to Documents path; collision gets a suffixed folder.
- Binary health: missing `ebook-convert` on PATH → friendly startup error naming the app reinstall remedy.
- Policy table additions for the translate-book allowlist (extends Phase 5 tests).
- E2E stays on echo-demo (fast); translate-book correctness is a smoke run, not CI.

**Implementation notes:** Smoke with the smallest baseline book (`tests/baselines/` in the skill repo, e.g. standard-alice) and low concurrency. Expect the parallelism finding (Open Q5) here; sequential degradation is acceptable — record it.

**Verification:** `pnpm test` green; `pnpm smoke:translate-book` (scripted dev-mode run on a baseline book) produces EPUB/DOCX/PDF/HTML in Documents; mid-run app kill → resume completes without redoing finished chunks (leans on skill `run_state.json` — the key resume acceptance item); hostile-prompt denial still friendly under the stricter policy.

**Dependencies:** Phases 5, 6, 7.

---

## Phase 9: i18n + branding proof (the "second manifest" criterion)

**Goal:** The whole UI renders in Hungarian by default and English on switch (FR-9.1), and the same unmodified shell runs echo-demo and translate-book with visibly different branding — the PRD's framework-not-hardcoded acceptance item, made repeatable.

**Scope:** Replace the `t()` stub with a real i18n layer (hu default, en); manifest-supplied localized task labels/descriptions; branding (colors/icon/name) fully manifest-driven incl. window title and theme tokens; locale setting in settings menu (persisted per PRD Settings).

**Out of scope:** Any new behavior; RTL or further locales.

**Likely code areas:** `packages/shell-renderer/src/i18n/` + a sweep of components; `ManifestLoader` (localized-string fields); settings persistence in `shell-main`.

**Tests first:**
- A test that fails on hardcoded strings: render top-level screens under a pseudo-locale and assert no untranslated marker leaks (component-level).
- Manifest localized labels: hu/en selection picks the right string with fallback.
- Branding application: two manifests → distinct theme tokens/window titles (snapshot-light assertions on the theme object, not pixels).
- E2E: switch locale in settings → home re-renders in English; relaunch keeps it.

**Implementation notes:** Keep it boring: JSON message catalogs + a typed `t()`; no runtime translation services.

**Verification:** `pnpm test` + `pnpm e2e` green; manual: boot both apps' manifests, confirm distinct look; flip locale.

**Dependencies:** Phases 3–8 (it sweeps the UI built so far).

---

## Phase 10: Two-layer updates — signed app bundles + shell auto-update

**Goal:** A changed prompt published to a local feed directory is picked up and active on next launch without reinstalling; a tampered bundle is rejected; the shell update path is wired (PRD acceptance items).

**Scope:** `packages/app-bundle-tools` CLI: validate manifest, pack bundle, Ed25519-sign (PRD Open Q8), emit feed JSON; shell: startup + 6h bundle check (FR-8.3), download → verify signature (public key compiled in, FR-8.4) → atomic staged swap → apply on next launch; update failures non-fatal (FR-8.6); electron-updater wiring against a per-channel feed URL with apply-on-restart only (FR-8.2); channel selection via config file (PRD Permissions: provisioner-controlled).

**Out of scope:** Hosting setup (feeds are static files; test against a local HTTP server / file URL), Windows code signing (Phase 11), delta updates.

**Likely code areas:** `packages/app-bundle-tools/src/`; `packages/shell-main/src/{bundle-updater,updater}.ts`; provisioner interplay (a newly applied bundle bumps the version Phase 8's re-provisioning keys off).

**Tests first:**
- bundle-tools: pack→verify round-trip; any byte flip fails verification; feed JSON points at the right artifact.
- Bundle updater integration (local HTTP fixture): newer version downloads, stages, applies on simulated relaunch; bad signature rejected and logged; unreachable feed → app continues (FR-8.6); running task blocks apply until next launch.
- Provisioning chain: applied bundle with bumped version triggers managed-file refresh (ties to Phase 8 test).
- E2E: launch with feed v1 → publish v2 (changed launcher label) → relaunch → label changed.

**Implementation notes:** `@noble/ed25519` for signatures; bundle = tar.gz + detached sig + JSON descriptor. electron-updater can only be fully exercised on packaged builds — wire and unit-test the surrounding logic now, prove it in Phase 11.

**Verification:** `pnpm test` + `pnpm e2e` green; manual local-feed walkthrough (publish, relaunch, observe change; tamper, observe rejection in log).

**Dependencies:** Phases 8, 9.

---

## Phase 11: Windows packaging & the release gate

**Goal:** A signed NSIS installer for Translate-Book that, on a clean Windows 10/11 VM with no developer tools, installs and passes the PRD acceptance flow: login → translate a baseline EPUB → outputs in Documents → resume after kill — the v1 release gate.

**Scope:** electron-builder NSIS config; dependency bundling per FR-8.1 (pinned codex.exe, Python embeddable, pandoc, Calibre portable) + PATH/spawn wiring so the agent and skill find them; `windowsSandbox/setupStart` during first-run provisioning if readiness requires (per Phase 2 findings); Windows code signing (Azure Trusted Signing per Open Q9); point electron-updater at a real channel feed and prove binary auto-update on Windows; binary health check now asserts the *bundled* tools.

**Out of scope:** macOS packaging, auto-update server infrastructure beyond static hosting, installer localization beyond hu/en strings already present.

**Likely code areas:** `apps/translate-book/electron-builder.yml` + `bundled/` acquisition scripts (`tools/fetch-deps.ts` with pinned URLs + checksums); `packages/shell-main/src/{binary-health,codex-spawn}.ts` (bundled paths, win32 quirks); CI build workflow (build + sign on a Windows runner).

**Tests first:**
- fetch-deps: checksum mismatch fails the build (supply-chain guard on pinned artifacts).
- Path resolution unit: packaged layout → resolved absolute paths for codex/python/pandoc/ebook-convert on win32 (table-driven, runs everywhere).
- Everything else in this phase is the manual VM protocol below — scripted as a checklist in `docs/release-gate.md`, executed and recorded per release.

**Implementation notes:** Apply Phase 2 findings here; this phase is where they pay off. Installer size is expected ~600MB+ — acceptable per PRD. Keep `fetch-deps` output git-ignored.

**Verification (the release gate, on a clean VM):** install from the signed artifact (no SmartScreen scare page); login (browser + device-code fallback); translate baseline EPUB end-to-end with visible chunk progress; outputs open from Documents; mid-run app kill → resume completes; codex-process kill → banner → resume; publish app-bundle v2 → relaunch → applied; shell binary update from channel feed applies on restart; hostile prompt denied politely. Record all in `docs/release-gate.md`.

**Dependencies:** Phases 2, 8, 9, 10.

---

## Final Verification

Automated (every phase, and all green before release):

- `pnpm install && pnpm build` — workspace builds clean.
- `pnpm test` — all vitest suites (adapter/mock-peer, ManifestLoader, PolicyEngine table, provisioner, SessionStore, bundle tools, components).
- `pnpm e2e` — Playwright-Electron suite on echo-demo with mock peer (launch→form→run→success; cancel; resume; locale switch; bundle-update relaunch).
- `pnpm smoke` — real-codex echo-demo turn (local, pinned codex 0.138.0).
- `pnpm smoke:translate-book` — dev-mode baseline-book translation, asserts output files exist.

Manual, against `PRD.md` Acceptance Criteria (each maps to a checklist line in `docs/release-gate.md`):

1. Clean-VM install → login screen, no errors (signed installer, no SmartScreen block).
2. ChatGPT browser login + device-code fallback both reach home.
3. Baseline EPUB translated via form→progress→success; outputs under `Documents/<AppName>/` and "Open folder" works.
4. Mid-run chat steering visibly affects the run; requestUserInput renders as a native form.
5. Hostile prompt: denial is friendly, no approval dialog ever, no hang.
6. App kill mid-run → resume completes without redoing finished chunks.
7. Codex-process kill → banner → one-click resume.
8. App-bundle update applies on relaunch; tampered bundle rejected (check log).
9. Shell auto-update applies on restart.
10. UI fully Hungarian by default, English on switch.
11. echo-demo manifest runs in the same shell unmodified with distinct branding.
12. Invalid manifest fails startup naming the field.
13. `git status` confirms `t3code/` untouched; `grep -r "effect" packages/*/package.json` shows no Effect.ts dependency.
