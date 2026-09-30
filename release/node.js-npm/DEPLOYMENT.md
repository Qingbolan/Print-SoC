# Publishing Print@SoC

Follow [VERSIONING.md](../../VERSIONING.md). Tide owns the npm version, desktop
version, and release tag. Do not use `npm version` or create release tags by hand.

`npm pack` in this directory stamps source builds from Tide automatically. The
published package uses its embedded version without requiring Tide or Git.
The release workflow publishes npm only when `publish_npm=true`, after desktop
assets are available. Keep `NPM_TOKEN` in GitHub repository secrets.
