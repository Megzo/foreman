# PRD: Foreman v1 — Vertical Agent App Shell + Translate-Book App

## Problem Statement

Non-technical employees at Hungarian SMEs (factory workers, office staff, translators) cannot use coding agents directly — even Codex's CLI/IDE surface is too much. Today, the value of agentic automation reaches them only through a consultant (Peter) operating the agent by hand. A paying client (a window-and-door manufacturer) has explicitly asked for a hand-off-able UI: their people open an app, log in, and get real answers from pre-configured automations without understanding agents, prompts, sandboxes, or terminals.

Foreman is a shell framework that turns "a project + skills + a locked-down policy" into an installable, single-purpose desktop GUI app running Codex underneath. V1 must prove the full chain with one real app: **Translate Book**, a GUI wrapper around the existing `translate-book` skill (`/home/megyo/projects/translate-book`), shipped as a Windows installer that works on double-click.

This PRD covers two deliverables: (1) the reusable shell framework, (2) the Translate-Book app built on it. The approved design doc (`/home/megyo/.claude/plans/this-was-an-idea-sprightly-wirth.md`) and `CLAUDE.md` in this repo are the decision record; this PRD operationalizes them.

## Goals

1. A reusable Electron shell where a new vertical app is defined primarily by an **app manifest** (branding, tasks, skills, sandbox policy, bundled dependencies) plus optional custom React components — not by forking the shell.
2. A working **Codex adapter** that drives `codex app-server` over JSON-RPC (newline-delimited JSON on stdio), behind an adapter interface that allows an OpenCode adapter to be added later without changing the UI layer.
3. **Login = Codex's own ChatGPT OAuth**, embedded in a branded screen; no Foreman-operated auth infrastructure.
4. End-users **never see raw agent approvals**; a per-app policy baked into the manifest auto-decides everything.
5. The **Translate-Book app**: pick a file → set options → watch progress → receive output files in Documents, with a task-scoped chat for steering.
6. A **Windows installer** that bundles every dependency (Codex CLI, embeddable Python, pandoc, portable Calibre) so a clean machine needs nothing pre-installed.
7. A **two-layer update mechanism**: shell binary auto-update + lightweight signed app-bundle (skills/prompts/manifest) updates.
8. The shell repo is **MIT open source** with Translate-Book as the open example vertical.

## Non-Goals

- Talk-to-my-DB and the ERP app (apps #2 and #3; they come after v1 on these rails).
- The OpenCode adapter (v2; v1 only defines the interface it must fit).
- Any server operated by us: no central accounts, no license enforcement, no telemetry backend, no remote agent execution.
- Multi-profile / multi-project workspaces (v2 manifest feature; v1 = one hidden workspace per app).
- The secrets/keychain **UI** (admin setup screen). The secrets *interface* is designed in v1 (manifest field + env injection), but Translate-Book declares no secrets, so no UI ships.
- macOS/Linux installers (dev mode must run on Linux/WSL and macOS, but packaging targets Windows only).
- MCP server integration, marketplace/plugin features, mobile, or web deployment.
- General-purpose chat: users cannot open a blank, unscoped agent conversation.
- Modifying anything under `t3code/` (read-only reference checkout).

## Actors

- **End user** — non-technical person using a shipped app (v1: someone translating books). Hungarian-speaking by default.
- **App author** — Peter (later other consultants): writes manifests and skills, scopes sandbox policies, builds installers.
- **Provisioner / client IT admin** — installs the app on machines, signs in or hands the machine to the user to sign in. (In v1 often the same person as the app author.)
- **Codex app-server** — `codex app-server` child process; executes the agent, enforces the OS sandbox, runs skills.
- **OpenAI / ChatGPT** — OAuth identity and model inference billing (customer-owned seats).
- **Update feed** — static hosting (GitHub Releases for shell binaries; static HTTPS bucket for app-bundles).
- **Bundled tools** — embeddable Python, pandoc, portable Calibre (`ebook-convert`), required by the translate-book skill.
- **OS services** — keychain (interface only in v1), Documents folder, default browser (for OAuth fallback).

## User Stories

1. As an end user, I want to install the app with one double-click and have it work, so that I never deal with Python, Calibre, terminals, or agent setup.
2. As an end user, I want to sign in once with the ChatGPT account my company gave me, so that I don't manage API keys or understand billing.
3. As an end user, I want a home screen with one obvious button ("Könyv fordítása" / "Translate a book"), so that I never face a blank prompt wondering what to type.
4. As an end user, I want to pick a PDF/DOCX/EPUB and a few simple options in a form, so that starting a translation feels like a normal desktop app, not a conversation.
5. As an end user, I want to see understandable progress ("Translating chunk 47 of 120…"), so that I trust a long-running job is working.
6. As an end user, I want to chat with the running task ("use formal you", "why is chapter 3 odd?"), so that I can steer without restarting.
7. As an end user, I want finished files to land in my Documents folder with an "Open folder" button, so that I can find my outputs without knowing about workspaces.
8. As an end user, I want the app to resume an interrupted translation instead of starting over, so that a crash or shutdown doesn't waste hours of work.
9. As an app author, I want to define a new vertical app as a manifest + skill files, so that shipping app #2 is days, not months.
10. As an app author, I want to push skill/prompt fixes through a lightweight update channel, so that improvements reach all installed machines without a 600 MB reinstall.
11. As an app author, I want to bake the sandbox/approval policy into the app, so that end-users are never asked to approve a shell command they cannot evaluate.
12. As a provisioner, I want a pinned release channel per client, so that an untested update never lands on a production machine.

## Functional Requirements

### FR-1 Manifest

- FR-1.1 The shell MUST load exactly one app manifest at startup (JSON, schema-validated) that defines: app id, name, version, branding (icon, colors, product name), locale, tasks[], skills[], sandbox policy, declared secrets (may be empty), bundled binary requirements, and update channel URLs.
- FR-1.2 Manifest validation failures MUST prevent startup with an error screen naming the invalid field (app-author-facing, English OK).
- FR-1.3 Each `tasks[]` entry MUST define: task id, launcher label + description (localized), the skill it invokes (`name` + relative path), a parameter form schema (fields: file picker, text, number, select, checkbox; each with label, required flag, default), and a completion definition (which output directory/files to present).
- FR-1.4 A manifest MAY reference a custom React component (by module path within the app bundle) for a task's UI, overriding the generic widget flow. The Translate-Book app MUST NOT need this (it is the proof that generic widgets suffice).

### FR-2 Agent adapter

- FR-2.1 The shell MUST define an `AgentAdapter` TypeScript interface covering: lifecycle (start/stop/health), auth (read state, begin login, cancel login, logout), session (start thread, resume thread, start turn, steer turn, interrupt turn), event stream (typed events: item started/delta/completed, turn completed, token usage, errors), and server-request callbacks (command approval, file-change approval, user-input request).
- FR-2.2 V1 MUST ship one implementation, `CodexAdapter`, that spawns the **bundled** `codex` binary with `app-server` and speaks JSON-RPC 2.0, one JSON object per line over stdio (verified protocol; see CLAUDE.md "protocol facts").
- FR-2.3 `CodexAdapter` MUST perform the handshake: `initialize` with `capabilities: { experimentalApi: true }`, then the `initialized` notification, before any other request.
- FR-2.4 The adapter MUST surface agent-message deltas (`item/agentMessage/delta`) to the UI with end-to-end latency under 100 ms in local testing.
- FR-2.5 If the codex process exits unexpectedly, the adapter MUST emit a terminal error event; the shell MUST offer the user a one-click "Restart" that restarts the process and resumes the thread via `thread/resume`.
- FR-2.6 The shell MUST pin and bundle a specific Codex CLI version per app release; the adapter MUST log (not block on) a version mismatch between expected and `initialize`-reported versions.

### FR-3 Authentication

- FR-3.1 On startup the shell MUST call `account/read`; if no account is present, it MUST show the login screen and block task access.
- FR-3.2 Login MUST use `account/login/start` with `type: "chatgpt"`, presenting the returned `authUrl` (opened in the system browser), and complete on the `account/login/completed` notification.
- FR-3.3 The shell SHOULD also support the `type: "chatgptDeviceCode"` flow (display `userCode` + `verificationUrl`) as a fallback for machines where browser redirect fails. *(Recommended assumption: implement both; device-code is cheap and factory machines are weird.)*
- FR-3.4 Logout MUST be available from a settings/account menu and call `account/logout`.
- FR-3.5 The shell MUST NOT store, copy, or proxy auth tokens; credential storage stays in Codex's own home (`$CODEX_HOME`). The shell MUST set `CODEX_HOME` to an app-specific directory so Foreman apps do not share or disturb a developer's own `~/.codex`.

### FR-4 Tasks, skills, and chat

- FR-4.1 Launching a task MUST render its parameter form from the manifest schema, validate required fields, then start a thread (workspace cwd, manifest sandbox mode) and start a turn whose input includes the skill reference (`{ type: "skill", name, path }`) plus a text item carrying the collected parameters.
- FR-4.2 The shell MUST provision the manifest's skill files into a location Codex discovers (recommended assumption: `$CODEX_HOME`-scoped skills dir, verified working via `skills/list` in the spike) during workspace provisioning, before the first task launch.
- FR-4.3 While a task runs, the user MUST be able to send chat messages, delivered via `turn/steer` when a turn is in progress and `turn/start` when idle.
- FR-4.4 Incoming `item/tool/requestUserInput` server requests MUST render as a native modal form (questions, options as radio/checkbox, free-text fallback); the user's answers MUST be returned as the JSON-RPC response.
- FR-4.5 The user MUST be able to cancel a running task (with confirmation), invoking `turn/interrupt`.
- FR-4.6 A task run MUST end in exactly one terminal UI state: success (completion definition satisfied), failed (turn error or completion unsatisfied), or cancelled.
- FR-4.7 Reasoning deltas (`item/reasoning/*`) MUST NOT be shown to end users. *(Recommended assumption: collapse to a subtle "thinking…" indicator.)*

### FR-5 Approval policy (no user-facing approvals)

- FR-5.1 The shell MUST answer every `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` programmatically from the manifest policy; no approval dialog is ever shown to an end user.
- FR-5.2 The manifest policy MUST express: sandbox mode for `thread/start` (e.g. `read-only`, `workspace-write`), an allowlist of command patterns answered `"approved"` (or `"approved_for_session"` for hot paths), and a default decision of `"denied"` for everything else.
- FR-5.3 A denied action MUST surface in chat as a friendly localized message (e.g. "Ezt a műveletet az alkalmazás nem engedélyezi"), and the turn MUST be allowed to continue (use `"denied"`, not `"abort"`).
- FR-5.4 All policy decisions (request, matched rule, decision) MUST be written to the local log file.
- FR-5.5 The Translate-Book app's policy MUST be: `workspace-write` sandbox, network access off, allowlist covering its bundled `python3`, `pandoc`, and `ebook-convert` invocations plus basic file operations within the workspace.

### FR-6 Workspace

- FR-6.1 On first run the shell MUST provision a single hidden per-app workspace under the app data directory: skill files, scripts, AGENTS.md/config from the app bundle.
- FR-6.2 Provisioning MUST be idempotent and versioned: when the app-bundle version changes, managed files are re-provisioned; user-generated files in the workspace are never deleted.
- FR-6.3 User-facing outputs MUST be copied (not moved) to `Documents/<AppName>/<job-name>/` at task completion, and the success state MUST link there.
- FR-6.4 The end user MUST never be shown a directory picker for the workspace or be required to know it exists.

### FR-7 Sessions and resume

- FR-7.1 The shell MUST persist per task run: run id, task id, thread id, parameters, status, timestamps, and the rendered chat transcript, surviving app restart.
- FR-7.2 On startup, runs that were in progress MUST be detected and offered for resume ("Folytatás" / "Új indítása"), using `thread/resume` plus the translate-book skill's own checkpointing (`run_state.json` makes re-running the skill on the same workspace resume cheaply).
- FR-7.3 A history screen MUST list past runs with status and a link to their output folders.

### FR-8 Updates and packaging

- FR-8.1 The Windows installer (NSIS via electron-builder) MUST bundle: the shell, the app bundle (manifest + skills), Codex CLI, embeddable Python, pandoc, and portable Calibre; after install on a clean Windows 10/11 machine, the only prerequisite is a ChatGPT login.
- FR-8.2 The shell binary MUST auto-update via electron-updater from a per-channel static feed; updates MUST NOT interrupt a running task (apply on next restart).
- FR-8.3 On startup (and at most once per 6 h while running) the shell MUST check the app-bundle channel; a new bundle (manifest, skills, prompts) MUST be downloadable without a shell reinstall and applied on next task launch.
- FR-8.4 App bundles MUST be signature-verified before installation. *(Recommended assumption: Ed25519/minisign signature, public key compiled into the shell binary per app.)*
- FR-8.5 Shell binaries MUST be Windows code-signed. *(Recommended assumption: Azure Trusted Signing — cheapest sane option in 2026.)*
- FR-8.6 Update failures MUST be non-fatal: the app continues on its current version and logs the failure.

### FR-9 Localization

- FR-9.1 All end-user-facing strings MUST go through an i18n layer; v1 ships `hu` (default) and `en`. Manifest task labels/descriptions carry their own localized strings.
- FR-9.2 App-author-facing errors (manifest validation, dev tooling) MAY be English-only.

## UX Requirements

- **Login screen**: app branding + one primary button ("Bejelentkezés ChatGPT-fiókkal"). Loading state while `authUrl` opens; a "use code instead" link for the device-code flow showing the code and URL; error state with retry on login failure/cancel. Never show raw OAuth errors — map to friendly text with a "details" expander.
- **Home screen**: app name/icon, the task launcher grid (v1: one large card per task), and a history list below. Empty history state: a short friendly explanation of what the app does. An account/settings menu (signed-in identity, logout, version numbers, "check for updates").
- **Task setup**: native form rendered from the manifest (Translate-Book: file picker [PDF/DOCX/EPUB filter], optional cover image, optional output name, optional free-text translation instructions, formal/informal address select). Invalid/missing required fields disable the start button with inline hints.
- **Task running view**: prominent status line + progress (per FR-4 events; for Translate-Book derive "chunk N of M" from item/command events and skill output), an activity feed of human-readable step descriptions (never raw commands or JSON), and the task-scoped chat pane. Cancel button with confirmation dialog.
- **Success state**: summary (translated title, file list with sizes), "Mappa megnyitása" (open Documents output folder) button, and the chat remains available for follow-ups.
- **Failure state**: friendly one-line cause, "Újrapróbálás" (resume-aware retry), and a "send details to support" affordance that opens a pre-filled email with the log file attached. *(Recommended assumption: mailto + log path; no telemetry backend in v1.)*
- **Agent restart state** (codex process died): non-scary banner ("A háttérszolgáltatás újraindult") with one-click resume.
- **No blank chat anywhere**: chat input only exists inside a task context.
- Visual design: clean, large-type, desktop-native feel; branding (colors, icon, name) driven by manifest. The shell must look like *the client's app*, not like a coding tool.

## Permission and Access Requirements

- **End user** can: log in/out, launch manifest-defined tasks, chat within a task, cancel/resume runs, open output folders. Cannot: change policy, edit the manifest, access the workspace, approve agent actions, or open an unscoped chat.
- **App author** (build time) controls: manifest content, sandbox policy and allowlist, bundled skill files, update channels, signing keys.
- **Provisioner** (install time) controls: which release channel the machine follows (installer flag or config file). No in-app admin UI ships in v1 (secrets UI deferred with the secrets feature).
- **Shell process** answers all agent approval requests per policy (FR-5); the Codex OS sandbox is the second defense layer beneath policy.
- The OS-level file permissions of the workspace and `CODEX_HOME` are the user's own; no elevation is required at runtime (installer MAY require admin per standard NSIS behavior).

## State and Data Requirements

- **App bundle (read-only at runtime)**: manifest.json, skill directories, AGENTS.md/config templates, branding assets, bundled-binary manifest. Versioned; replaced atomically by app-bundle updates (download → verify signature → swap directory → mark pending → apply on next launch).
- **Workspace (per app, hidden)**: provisioned skill/scripts copies, the translate-book skill's own state (`{book}_temp/` dirs, `run_state.json`, `glossary.json`, `SUMMARY.md`, `manifest.json`). Provisioning state file records bundle version + managed-file hashes (FR-6.2).
- **Session store**: local, file-based. *(Recommended assumption: one JSONL transcript file per run + a small SQLite index for runs/threads; SQLite via better-sqlite3.)* Tracks run records (FR-7.1) and maps run → Codex thread id for resume.
- **Auth state**: owned entirely by Codex under the app-specific `CODEX_HOME`; the shell persists nothing about credentials, only the last-known `account/read` snapshot for instant UI rendering (refreshed on startup).
- **Settings**: locale override, update channel, window geometry — plain JSON in app data.
- **Logs**: rotating local log files (protocol-level decisions per FR-5.4, errors, update events); no remote transmission.
- **Migrations**: v1 defines schema versions for manifest, session index, and provisioning state from day one; unknown-newer versions fail safe with an "update the app" message.
- **Derived state**: task progress (from event stream), resume availability (from session store + workspace `run_state.json`).

## Integration and Side-Effect Requirements

- **Codex app-server child process**: the only agent integration; spawned/supervised by the shell; all inference and tool execution flow through it. Inference billing hits the signed-in ChatGPT account.
- **System browser**: opened for ChatGPT OAuth (`authUrl`); no embedded webview for OAuth in v1 (simpler, and OpenAI may block embedded webviews).
- **Bundled binaries**: python3 (embeddable), pandoc, Calibre's `ebook-convert` invoked *by the agent* inside the sandbox; the shell only verifies their presence at startup (health check with friendly repair message: "reinstall the app").
- **File outputs**: translated books copied to `Documents/<AppName>/...` (FR-6.3).
- **Update feeds**: HTTPS GET only — electron-updater feed (shell) + static JSON manifest & signed archive (app bundle). These are the only network calls the shell itself makes.
- **No analytics/telemetry events** in v1. No email/notification sending (the support affordance opens the user's own mail client).

## Implementation Notes

New repo or top-level directories in this repo (keep `t3code/` untouched as reference):

- `packages/shell-main` (Electron main): `ManifestLoader` (+ JSON schema), `AgentAdapter` interface + `CodexAdapter` (port the dependency-free JSON-RPC client from `spike-codex-app-server/probe.mjs`; type protocol messages against `t3code/packages/effect-codex-app-server/src/_generated/schema.gen.ts` — grep it rather than guessing params), `PolicyEngine` (approval matching, FR-5), `WorkspaceProvisioner` (FR-6), `SessionStore` (FR-7), `Updater` (two layers, FR-8), `BinaryHealthCheck`, IPC contract to renderer (typed, event-stream oriented).
- `packages/shell-renderer` (React): login screen, launcher home, generic task widgets (param form renderer, progress/activity feed, chat pane, outputs panel, requestUserInput modal), i18n (`hu`/`en`), theming from manifest branding.
- `apps/translate-book`: manifest.json, the skill bundle (synced from `/home/megyo/projects/translate-book` — decide sync direction; recommended: that repo stays the source of truth, app bundle vendors a pinned copy), branding assets, electron-builder + dependency-bundling config (Codex CLI, Python embeddable, pandoc, Calibre portable).
- `packages/app-bundle-tools` (app-author CLI): validate manifest, build + sign app bundles (Ed25519), publish to a feed directory.

Useful existing references: T3's `CodexAdapter`/`CodexSessionRuntime` under `t3code/apps/server/src/provider/` (event mapping ideas), and T3's mock peer `t3code/packages/effect-codex-app-server/test/fixtures/codex-app-server-mock-peer.ts` (pattern for a test double — reimplement plainly, don't import Effect.ts).

Codex version currently verified: codex-cli **0.138.0** (spike passed 2026-06-11 on WSL2). Pin it.

## Testing Requirements

Behavior-focused, through public interfaces:

1. **Adapter integration (mock peer)**: a plain-Node fake app-server (scripted JSONL responses) validates: handshake ordering, request/response correlation, delta streaming order, server-request → response round-trip (approvals, requestUserInput), process-death → error event → restart/resume.
2. **Adapter smoke (real codex)**: CI-optional, locally-runnable test that drives the bundled codex binary end-to-end (the spike scenario: SPIKE_OK turn) and a skill-invocation turn; asserts on observable events only.
3. **PolicyEngine**: table-driven tests mapping (manifest policy × approval request) → decision, including default-deny, allowlist hits, `approved_for_session`, and the "denied continues the turn" contract (assert the response value, not internals).
4. **ManifestLoader**: valid manifests load; each invalid field class produces a startup error naming the field.
5. **WorkspaceProvisioner**: fresh provision, idempotent re-run, bundle-version upgrade re-provisions managed files, user files survive.
6. **SessionStore/resume**: run lifecycle persistence across simulated restart; in-progress run is offered for resume with correct thread id.
7. **Renderer widget tests**: param form renders from schema and enforces required fields; requestUserInput modal returns the protocol-shaped answer; progress view renders from a recorded event stream; all four task terminal states render.
8. **E2E (the release gate)**: on a clean Windows VM, install the built Translate-Book installer, log in, translate one of the translate-book repo's baseline books (`tests/baselines/`, e.g. standard-alice), and verify output files appear in Documents and open. Repeat with a mid-run app kill → relaunch → resume completes.
9. **Update tests**: app-bundle with bad signature is rejected; good bundle applies on next launch; shell continues when feeds are unreachable.

## Acceptance Criteria

- [ ] On a clean Windows 10/11 machine with no developer tools, the Translate-Book installer installs and the app reaches the login screen with no errors.
- [ ] A user can sign in with ChatGPT (browser flow; device-code fallback available) and reach the home screen showing the "Translate a book" launcher.
- [ ] A user can translate a baseline EPUB end-to-end via form → progress → success, and the outputs (EPUB/DOCX/PDF/HTML) appear under `Documents/<AppName>/` via the "Open folder" button.
- [ ] During a run, chat steering works (e.g. instructing formal address) and `requestUserInput` questions appear as native forms.
- [ ] No approval dialog is ever shown; an out-of-policy command (test via a deliberately hostile prompt) is denied, surfaced as a friendly chat message, and the task continues or fails gracefully — it never hangs.
- [ ] Killing the app mid-translation and relaunching offers resume, and resume completes without redoing finished chunks.
- [ ] Killing the codex process mid-run shows the restart banner and one-click resume works.
- [ ] A new app bundle (changed prompt text) published to the feed is picked up and active on next launch without reinstalling; a tampered bundle is rejected.
- [ ] The shell binary auto-updates from the channel feed on restart.
- [ ] All end-user-visible text appears in Hungarian by default and English when switched.
- [ ] A second toy manifest (different branding, one trivial echo-skill task) runs in the same shell unmodified — proof the framework isn't hardcoded to Translate-Book.
- [ ] Manifest with an invalid field fails startup with a clear, field-naming error.
- [ ] `t3code/` remains unmodified; shell code contains no Effect.ts dependency.

## Open Questions and Recommended Answers

1. **Does Codex app-server behave on native Windows (sandbox, OAuth, child processes)?** — The protocol has `windowsSandbox/readiness`/`setupStart`, so a native path exists, but it is unverified on a real machine. *Recommendation: run the existing spike on a Windows VM in week 1; if the Windows sandbox requires setup, the shell drives `windowsSandbox/setupStart` during first-run provisioning. If natively broken, fall back to pulling the OpenCode adapter forward.*
2. **How is task progress derived for Translate-Book ("chunk N of M")?** — *Recommendation: parse `item/commandExecution` output events for the skill's script invocations (run_state/merge_meta status output) plus a lightweight convention: the skill writes a `progress.json` in the workspace that the shell file-watches. Add that convention to the skill as a backward-compatible addition; agent-message heuristics alone are too fragile.*
3. **Skill installation scope** — user-scope skills dir under the app's `CODEX_HOME` vs. project-scope in the workspace. *Recommendation: `CODEX_HOME`-scoped (verified discovered in the spike); keeps the workspace purely for job data.*
4. **Does `turn/steer` interleave acceptably mid-skill-execution?** — Unverified. *Recommendation: test during adapter work; if steering mid-turn is unreliable, queue chat messages and deliver as the next `turn/start` with a UI note ("a fordítás után válaszolok").*
5. **Sub-agent parallelism for translate-book under app-server** — the skill assumes parallel sub-agents; Codex's mechanism under app-server is unverified. *Recommendation: verify early with a real book; if parallelism is unavailable, the skill degrades to sequential chunk translation (slower but correct) — acceptable for v1, document the limitation.*
6. **ChatGPT seat licensing at clients** — per-user company seats (Business) are assumed. *Recommendation: confirm with the window-manufacturer client before the Talk-to-DB pilot quote; not a v1 software blocker since Translate-Book's first user is Peter himself.*
7. **Repo layout** — new repo vs. this directory. *Recommendation: develop in this repo (pnpm workspace beside `t3code/`, which stays untouched and git-ignored or submoduled), and extract to a clean public repo at first OSS release; revisit CLAUDE.md placement then.*
8. **App-bundle signing tooling** — *Recommendation: Ed25519 via `tweetnacl`/`@noble/ed25519` in `app-bundle-tools`, public key per app compiled into the shell build; avoid platform code-signing machinery for bundles.*
9. **Windows code-signing certificate** — *Recommendation: Azure Trusted Signing; budget it now, as unsigned + SmartScreen warnings would fail the install-experience acceptance criterion with this audience.*
