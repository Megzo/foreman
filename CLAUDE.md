# Foreman — vertical agent app shell

Open-source (MIT) Electron shell framework for building installable, single-purpose agent GUI apps for non-technical users — each app is "a project + skills + a locked-down UI" with Codex running underneath. Built by Peter Megyesi as leverage for his agentic-automation consulting for Hungarian SMEs. Target segment: people for whom even Codex is too much.

Full design doc (15 interview-resolved decisions, approved 2026-06-11):
`/home/megyo/.claude/plans/this-was-an-idea-sprightly-wirth.md`

## What is in this directory

- `t3code/` — read-only reference checkout of T3 Code (MIT). **Rejected as a fork target**; we build our own thin shell. Do not modify it. Its value:
  - `t3code/packages/effect-codex-app-server/src/_generated/schema.gen.ts` — full generated type schema of the Codex app-server protocol (the authoritative reference for params/results).
  - `t3code/packages/effect-codex-app-server/test/examples/codex-app-server-probe.ts` — minimal protocol handshake example.
  - `t3code/apps/server/src/provider/Drivers/` — how T3 drives Codex/OpenCode/Claude.
- `spike-codex-app-server/probe.mjs` — zero-dependency Node spike that drives `codex app-server` end-to-end (handshake → auth → skills → thread → turn → streamed deltas). Passed 2026-06-11 on codex-cli 0.138.0. Run: `node spike-codex-app-server/probe.mjs`.
- `packages/codex-adapter/` — Phase 1 (done 2026-06-11): typed JSONL JSON-RPC client + `AgentAdapter` interface + `CodexAdapter` (spawn/supervise, handshake, `CODEX_HOME` override), tested against the scripted `test/fixtures/mock-peer.mjs`. Dev CLI: `pnpm foreman-dev chat|auth-status` (`tools/foreman-dev.ts`). Next milestones: Phase 2 (Windows check, needs Peter's machine) and Phase 3 (Electron skeleton).

## Core design decisions (do not re-litigate; details in the design doc)

1. **Truly local desktop app** — agent, skills, runtime all on the end-user's machine; no server we operate.
2. **Login = Codex's own ChatGPT OAuth** (`account/login/start`); zero auth infra; billing on the customer's seats.
3. **Own thin shell on `codex app-server` JSON-RPC** (newline-delimited JSON over stdio). OpenCode (`opencode serve`) is adapter #2, later — design the adapter interface so it's additive.
4. **App = config manifest** (branding, skills, task launchers, sandbox policy, secrets, bundled deps) + generic widget set (file picker, params form, progress, outputs panel, chat) + per-app custom React component escape hatch.
5. **Per-app sandbox/approval policy baked at authoring time** — end-users never see approval prompts; out-of-policy actions are auto-denied and surface as friendly chat messages.
6. **One hidden app-managed workspace per app**, provisioned from the manifest on first run; user outputs go to Documents.
7. **Task launchers first, chat scoped to a running task** — never a blank prompt. Skill `AskUserQuestion` renders as native forms.
8. **Secrets**: OS keychain (keytar) + env-var injection into the agent process, only for manifest-declared vars; credentials are least-privilege (read-only DB users, scoped tokens).
9. **Windows-first**, macOS second; installer bundles all manifest-declared deps (Codex CLI, embeddable Python, pandoc, portable Calibre). Big installer is fine — "double-click and it works" is the product.
10. **Electron**, TypeScript everywhere.
11. **Two-layer updates**: shell binary via electron-updater (per-client channels) + lightweight signed app-bundle channel (skills/prompts/manifest fetched on launch). Windows code-signing cert required.
12. **Sequencing**: Translate-Book app (from `/home/megyo/projects/translate-book`) → Talk-to-my-DB (adds secrets + custom widget; doubles as the ERP client's paid pilot) → full ERP app for the window-and-door manufacturer.
13. **Commercial**: MIT shell + open example verticals (incl. translate-book as the free flagship demo); client-specific manifests/skills/branding stay private. This is a consulting-leverage play, distinct from the separate ERP-ISV copilot product idea.

## Codex app-server protocol facts (verified by the spike, codex-cli 0.138.0)

- Wire: JSON-RPC 2.0, one JSON object per line over stdio. Handshake: `initialize` (send `capabilities: { experimentalApi: true }`) then `initialized` notification.
- Lifecycle: `thread/start` (cwd, sandbox, model) → `turn/start` (threadId, input[]) → notifications `item/started`, `item/agentMessage/delta`, `item/completed`, `turn/completed`. Also `turn/steer`, `turn/interrupt`, `thread/resume`.
- **Skills are first-class**: `skills/list { cwds }` discovers SKILL.md skills (user scope: `~/.agents/skills/`, system: `~/.codex/skills/.system/`); `turn/start` input accepts `{ type: "skill", name, path }` — this is the manifest task-launcher mapping.
- Server→client JSON-RPC **requests** the shell must answer: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` (enforce baked policy here), `item/tool/requestUserInput` (render as native form).
- Auth: `account/read` reports login state; `account/login/start|completed|cancel` enable embedded ChatGPT OAuth.
- Windows: `windowsSandbox/readiness` / `windowsSandbox/setupStart` exist — native Windows sandbox path is present, **but an actual Windows-machine test is still the #1 open risk** before committing to Windows-first.
- Pin the Codex CLI version per app-bundle release — the protocol serves OpenAI's IDE needs and can churn.

## Conventions

- Don't add dependencies to spike scripts — they prove the protocol works bare.
- New shell code: TypeScript, plain JSON-RPC client (no Effect.ts — that's T3's idiom, not ours).
- When protocol params are unclear, grep `schema.gen.ts` in the T3 checkout rather than guessing.
