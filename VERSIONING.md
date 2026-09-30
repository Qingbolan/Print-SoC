# Tide version management

Tide 1.0.0 is the sole version authority for this repository. Do not use `npm
version`, edit a manifest version by hand, or supply an arbitrary release version.
The tracked manifest values are build snapshots; the build refreshes them from
Git before packaging.

Install the pinned CLI with `brew install qingbolan/tap/tide` on Apple Silicon, or:

```bash
cargo install --git https://github.com/Qingbolan/TideMark --rev d0fadb4db3f15e329e9cce2d99a6c629560d045c --locked --bin tide
```

Use a full Git checkout. `.tidemark.toml` fixes the timezone to `+08:00` and uses
local tags, so a given checkout does not depend on the machine timezone or network.
Fetch tags before intentionally updating the release-anchor inventory.

```bash
python3 scripts/version.py show
python3 scripts/version.py sync
python3 scripts/version.py check
```

The shared projection updates the desktop package and lockfile, Tauri metadata,
Cargo manifest and lockfile, Python package version, and npm package version.
The settings page and CLI/MCP version reports read those generated values.
Desktop builds, Python source builds, and npm packing run the projection
automatically. Published wheels, source distributions, and npm packages retain
their stamped version and do not require Git or Tide to install.

## Release

```bash
gh workflow run build-release.yml --ref main -f publish_pypi=true -f publish_npm=false
```

CI resolves Tide exactly once and passes a JSON receipt containing its coordinate
and source commit to every job. A job refuses a receipt for another commit.
All platforms and registries use this same coordinate. Desktop assets must be
available before publishing package launchers. A fresh `print-soc --install`
updates the separately installed desktop binary; upgrading pip alone does not.

Release tags `v<coordinate>` are lightweight and immutable. Only **annotated**
`v*` tags are Tide epoch anchors; adding an anchor is an explicit version-policy
change. Automatically generated release tags must not become new anchors, which
would change the coordinate while building the release. With no annotated
anchor, the pinned Tide CLI uses the repository root as epoch zero.

## Windows MSI projection

MSI limits its first two version fields to 255 and the third to 65535. Tide's
natural-day component can exceed 255, so only the MSI installer field uses:

```
Tide: epoch.days.index
MSI:  epoch.(days // 256).((days % 256) * 256 + index)
```

This preserves ordering for epoch <= 255, days <= 65535, and same-day index <=
255. Builds fail outside those bounds instead of truncating or reusing a version.
For example, Tide `0.328.4` produces MSI `0.1.18436`. App metadata, release tags,
Python and npm retain `0.328.4`.
