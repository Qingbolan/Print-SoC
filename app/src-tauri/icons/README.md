# Desktop icon sources

`icon.icns` is the original macOS asset, unchanged from release v0.375.4
(SHA-256 `c385c5eeb39f74c586781aa89350b69a220227ccfaf1ed6b919397ebebe4e891`).
macOS 26 renders this asset as the white/silver rounded tile with a small blue
printer and orange @SoC lettering approved by the user. Older macOS versions
may render the original transparent icon differently.

`app-icon.png` is the 1024px NSWorkspace rendering extracted from the installed
v0.375.4 application on macOS 26.5.1. It supplies the same appearance for
Windows/Linux and web assets; it is not an AI-generated reconstruction.

Run `npm --prefix app run tauri:icon` from the repository root. The generator
updates all PNG/ICO sizes and public logos while preserving the macOS ICNS so
macOS does not apply its frame to an already framed tile.
