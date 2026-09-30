# Build and release Print@SoC

[VERSIONING.md](../VERSIONING.md) is the authoritative version and publication
guide. Tide supplies the version for the desktop app, Python/npm launchers, and
Codex plugin. There are no manual per-package version bumps.

## Local desktop build

Install Node.js 20+, Rust stable, Tide 1.0.0, and the native Tauri build dependencies
for the target OS. On macOS, install the Xcode command-line tools. Then:

```bash
cd app
npm ci
npm run check
npm run tauri:build
```

The npm lifecycle hooks synchronize Tide before the desktop build. The resulting
bundles live under `app/src-tauri/target/release/bundle/`.

## Coordinated release

Commit the source and push it before dispatching:

```bash
gh workflow run build-release.yml --ref main -f publish_pypi=true -f publish_npm=false
```

CI resolves a version receipt once, tests the Python/npm distributions, builds
macOS ARM/Intel, Windows x64 and Linux x64, checks macOS bundle versions, then
publishes the GitHub desktop assets. Only after that does it publish enabled
package registries. npm publication is opt-in.

Do not retag an existing version or replace it with another source commit. Fixes
require a new commit, which produces a new Tide coordinate. Registry credentials
belong in GitHub secrets, never in this repository.

## Updating an installation

The desktop binary is installed separately from the pip/npm launcher:

```bash
pip install --upgrade print-at-soc
print-soc --install
```

Confirm the reinstall prompt to replace an existing desktop installation.
