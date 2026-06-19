# Propagate integration

Everything propagate needs to customize a fork lives here. Keep `app.manifest.yaml` at the repo root.

```
propagate/
  workflow.yml              # canonical workflow spec (sync to .github/workflows/propagate-codemods.yml)
  codemods/*.mjs            # deployment transforms
  scripts/run-workflow.mjs  # workflow entrypoint (codemods + commit)
```

## GitHub Actions shim

GitHub only runs workflows from `.github/workflows/`. Copy or sync `propagate/workflow.yml` to:

```
.github/workflows/propagate-codemods.yml
```

Set `deploy.workflow: propagate-codemods` in `app.manifest.yaml`.

## Codemods

Each codemod exports `async function(ctx, fs)` and reads/writes files via the provided `fs` helper. List paths under `deploy.codemods` in the manifest.
