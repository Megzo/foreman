
---

## Progress reporting for the Foreman shell (optional, backward-compatible)

When running inside the Foreman shell, the GUI shows a "N. fejezet / N of M"
progress bar by watching a single file. Keep it updated so the user trusts the
long-running job.

**Convention:** write a JSON file named `progress.json` in the **current working
directory** (the shell's workspace root — *not* inside `{filename}_temp/`).
Overwrite it atomically each time the count advances:

```json
{ "current": 12, "total": 120, "phase": "translating", "label": "12. fejezet" }
```

- `current` / `total` (required, integers) — chunks finished and total chunks.
  Derive `total` from the chunk manifest after preprocessing.
- `phase` (optional) — e.g. `"preprocessing"`, `"translating"`, `"building"`.
- `label` (optional) — a short human note shown beside the bar.

Update it: once after preprocessing (`current: 0, total: M`), after **every
batch** of translated chunks, and once when the build step starts. A malformed
or missing file is ignored by the shell, so this is safe to omit — it only
improves the displayed progress.
