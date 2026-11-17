#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'src-tauri/icons/app-icon.png')
const publicDir = path.join(root, 'public')
await fs.mkdir(publicDir, { recursive: true })
for (const name of ['logo.png', 'logo-app-icon.png']) {
  await fs.copyFile(source, path.join(publicDir, name))
}
console.log('[assets:logo] Synced the approved desktop tile to public logos')
