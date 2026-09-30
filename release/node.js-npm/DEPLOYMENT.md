# Publishing Print@SoC

Follow [VERSIONING.md](../../VERSIONING.md). Tide owns the npm version, desktop
version, and release tag. Do not use `npm version` or create release tags by hand.

`npm run package` in this directory stamps source builds from Tide before invoking
npm. Direct `npm pack` rejects stale version metadata. The
published package uses its embedded version without requiring Tide or Git.
The release workflow publishes npm only when `publish_npm=true`, after desktop
assets are available. Keep `NPM_TOKEN` in GitHub repository secrets.
