import { safeInvoke } from '@/lib/tauri-utils'
import type { SavedCredentials } from '@/store/printer-store'
import type { SSHConfig } from '@/types/printer'

export function savedAccountConfig(account: SavedCredentials): SSHConfig {
  return {
    host: `${account.serverType}.comp.nus.edu.sg`,
    port: 22,
    username: account.username,
    auth_type: { type: 'StoredPassword' },
  }
}

export async function deleteSavedPassword(account: SavedCredentials): Promise<void> {
  const result = await safeInvoke<boolean>('credential_delete', { config: savedAccountConfig(account) })
  if (!result.success) throw new Error(result.error || 'Could not delete saved password')
}

export async function savePassword(config: SSHConfig, previous?: SavedCredentials | null): Promise<void> {
  const result = await safeInvoke<boolean>('credential_save', { config, previousConfig: previous ? savedAccountConfig(previous) : null })
  if (!result.success) throw new Error(result.error || 'Could not save password')
}
