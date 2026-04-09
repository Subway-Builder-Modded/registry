# Releasing @registry/schemas

Publishing is triggered automatically when a `v*` tag is pushed. The GitHub Actions workflow builds the package, emits JSON Schema files, and publishes to GitHub Packages.

## Steps

### 1. Make schema changes

Edit files under `schemas/src/`. If you are changing the **data format** of a JSON file (e.g., adding a required field, changing a field type), also increment the `schema_version` literal inside the relevant Zod schema.

### 2. Rebuild and commit JSON schemas

The `json-schemas/` directory is committed to the repo so downstream consumers can reference schemas without running a build.

```bash
cd schemas
pnpm install
pnpm build
pnpm emit-json-schemas
```

Commit the updated `json-schemas/*.schema.json` and `json-schemas/index.json` along with your source changes.

### 3. Bump the package version

Edit `schemas/package.json` — increment `version` following semver:
- **patch** (`1.0.x`): backward-compatible fixes (typos, tighter constraints that existing data already satisfies)
- **minor** (`1.x.0`): backward-compatible additions (new optional fields, new schemas)
- **major** (`x.0.0`): breaking changes (removed fields, renamed types, changed required constraints)

### 4. Verify

```bash
# From repo root
cd schemas && pnpm build && pnpm emit-json-schemas
cd ../scripts && npx tsc --noEmit
```

### 5. Tag and push

```bash
git tag v<version>   # e.g. git tag v1.1.0
git push origin v<version>
```

The [publish-schemas workflow](.github/workflows/publish-schemas.yml) runs on the tag push. Monitor it in the Actions tab.

## Consuming the new version

The `scripts/` package references `"@registry/schemas": "workspace:*"` and always uses the local workspace version. External consumers (e.g., the Go app via quicktype) should update their dependency to the new tag.
