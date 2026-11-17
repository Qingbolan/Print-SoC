import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const icons = path.join(root, 'src-tauri/icons')
// macOS renders the original ICNS into the user-approved system tile. Preserve
// that source so a generated tile is not framed a second time by the OS.
const macIcon = await fs.readFile(path.join(icons, 'icon.icns'))
const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'print-soc-icons-'))
try {
  const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js')
  execFileSync(process.execPath, [cli, 'icon', path.join(icons, 'app-icon.png'), '-o', staging], { stdio: 'inherit' })
  await fs.writeFile(path.join(staging, 'icon.icns'), macIcon)
  await fs.cp(staging, icons, { recursive: true })
  execFileSync(process.execPath, [path.join(root, 'scripts/sync-logo.mjs')], { stdio: 'inherit' })
} finally {
  await fs.rm(staging, { recursive: true, force: true })
}
