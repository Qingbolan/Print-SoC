import { isTauriAvailable, safeInvoke } from '@/lib/tauri-utils'
import type { SavedCredentials } from '@/store/printer-store'
import type { SSHConfig } from '@/types/printer'

export function savedAccountConfig(account: SavedCredentials): SSHConfig {
  return {
    host: account.host || `${account.serverType}.comp.nus.edu.sg`,
    port: account.port || 22,
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

export async function restoreSharedAccount() {
  if (!isTauriAvailable()) return
  const { usePrinterStore } = await import('@/store/printer-store')
  const state = usePrinterStore.getState()
  const legacy = state.accountMigrated ? null : state.savedCredentials
  const result = await safeInvoke<SSHConfig | null>('account_current', { legacyFrontend: legacy ? savedAccountConfig(legacy) : null })
  if (!result.success) throw new Error(result.error || 'Cannot load shared account')
  const config = result.data
  const sameIdentity = (a: SSHConfig | null, b: SSHConfig | null) => a?.host.toLowerCase() === b?.host.toLowerCase() && a?.port === b?.port && a?.username === b?.username
  const previous = state.savedCredentials ? savedAccountConfig(state.savedCredentials) : null
  const current = usePrinterStore.getState()
  if (state.accountMigrated && !sameIdentity(previous, config ?? null) && current.sshConfig && sameIdentity(current.sshConfig, previous)) {
    current.clearConnectionSession()
    await safeInvoke('ssh_disconnect')
  }
  usePrinterStore.getState().setSharedAccount(config ? {
    serverType: config.host.startsWith('stf.') ? 'stf' : 'stu', host: config.host, port: config.port,
    username: config.username, rememberMe: true, passwordSaved: true,
  } : null)
}
