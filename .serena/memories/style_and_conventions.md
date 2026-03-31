# Style and conventions
- TypeScript is strict and ESM-based (`moduleResolution: bundler`, `type: module`).
- Scripts prefer small focused helpers in `scripts/lib` and thin CLI wrappers in `scripts/*.ts`.
- Data generation code tends to use typed row interfaces, deterministic sorting, and explicit CSV header ordering.
- Tests use `node:test` with `assert/strict`; temp repo fixtures under `%TEMP%` are common for end-to-end script coverage.
- Keep edits pragmatic and localized; avoid broad refactors when extending analytics outputs.
- Repo artifacts are primarily UTF-8 text/JSON/CSV and should stay deterministic for workflow regeneration.