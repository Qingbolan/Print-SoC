Icon update instructions

Place the provided 1024×1024 PNG here as `app-icon.png` and run:

  npm run tauri:icon

The command generates all required sizes plus `icon.icns` and `icon.ico` back into this folder. The Tauri config (`app/src-tauri/tauri.conf.json`) already points to:

- `icons/32x32.png`
- `icons/128x128.png`
- `icons/128x128@2x.png`
- `icons/icon.icns`
- `icons/icon.ico`

After regeneration, build packages normally with `npm run tauri:build`.

