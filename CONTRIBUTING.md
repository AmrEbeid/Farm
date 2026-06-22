# Contributing to @amrebeid/ui

This is an npm-workspaces monorepo. The library lives in [`packages/ui`](packages/ui);
Changesets, CI, and the registry config live at the repo root.

## Adding a changeset (required for any user-facing change)

Every PR that changes the published surface (components, props, tokens, styles,
exports) must include a changeset. From the **repo root**:

```bash
npm run changeset
```

Pick the bump type and write a one-line summary:

- **patch** — bug fix, token tweak, internal change with no API change.
- **minor** — new component, new prop, additive theming dimension (the norm while we are `0.x`).
- **major** — breaking API change. **Do not select major before 1.0** — while in `0.x` use minor for breaking changes (semver pre-1.0 convention) unless the change is the deliberate 1.0 cut.

Commit the generated `.changeset/*.md` file alongside your code. A PR without a
changeset will not bump the version or appear in the CHANGELOG.

## How releases happen

On merge to `main`, the `release` workflow (`.github/workflows/release.yml`) runs
`changesets/action`:

1. If unreleased changesets exist, it opens/updates a **"Version Packages"** PR
   that applies the bumps and regenerates `packages/ui/CHANGELOG.md`.
2. When that PR is merged, the workflow runs `npm run release`
   (`changeset publish`) and publishes to **GitHub Packages** under the
   `@amrebeid` scope.

While the package is `"private": true` (pre-1.0), `changeset publish` is a no-op
— version PRs and the CHANGELOG still work; nothing is published yet.

## Registry

Default registry is **GitHub Packages** (`https://npm.pkg.github.com`), routed by
`.npmrc` (`@amrebeid:registry=...`) and enforced by `publishConfig` in
`packages/ui/package.json`. Publishing under the `@amrebeid` scope uses the
built-in `GITHUB_TOKEN` (the scope matches the repo owner) — no extra PAT needed.

### Installing as a consumer

Consumers add an `.npmrc` with the scope route and a read token:

```ini
@amrebeid:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

then `npm i @amrebeid/ui` with `NODE_AUTH_TOKEN` set to a `read:packages` token.

### Alternative: npm private registry

To publish to npm's private registry instead of GitHub Packages:

1. In `packages/ui/package.json` set `"publishConfig": { "registry": "https://registry.npmjs.org", "access": "restricted" }`.
2. Replace `.npmrc` with `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` and drop the `@amrebeid:registry` GitHub line.
3. In `release.yml` set `registry-url: https://registry.npmjs.org` and provide `NODE_AUTH_TOKEN` from an `NPM_TOKEN` secret (an automation token with publish rights).

## Cutting 1.0

1.0 is the publish-ready milestone (full catalog + theming + green CI). To cut it:

1. Land a changeset that bumps to `1.0.0`.
2. Set `"private": false` in `packages/ui/package.json`.
3. Merge the "Version Packages" PR — `release.yml` then publishes `@amrebeid/ui@1.0.0`
   to GitHub Packages via the `prepublishOnly` (typecheck + test + build) gate.
