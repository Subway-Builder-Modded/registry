# Task completion checklist
- If script logic changed, run at least `pnpm --dir scripts run test:build` and targeted `node --test` coverage for affected tests.
- For analytics/output changes, regenerate the relevant CSVs with the matching script entrypoint and verify the intended artifact(s).
- Check `git status --short` and keep the diff focused; revert unrelated generated artifacts if they are only incidental side effects.
- Summarize any commands that required non-sandbox execution or special flags (for example `--test-isolation=none`).