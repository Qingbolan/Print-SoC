import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function setup() {
  const exports = {}
  let persistence
  const source = readFileSync(new URL('../src/store/printer-store.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    require(name) {
      if (name === 'zustand') return require(name)
      if (name === 'zustand/middleware') return { persist: (config, options) => { persistence = options; return config } }
      if (name === '@/data/printers') return { DEFAULT_PRINTER_QUEUE: 'psts', PRINTERS: [], groupPrinters: () => [], normalizePrintQueueName: value => value }
      throw new Error(name)
    },
  })
  return { store: exports.usePrinterStore, persistence }
}
test('migration clears browser identity but retains the explicit auto-login preference', () => {
  const {store, persistence} = setup()
  const account = {username:'frontend-user',serverType:'stu',rememberMe:false,passwordSaved:true}
  store.getState().setSavedCredentials(account)
  assert.equal(persistence.partialize(store.getState()).savedCredentials.username, 'frontend-user')
  store.getState().setSharedAccount({...account, rememberMe:true})
  assert.equal(store.getState().savedCredentials.rememberMe, false)
  const saved = persistence.partialize(store.getState())
  assert.equal(saved.savedCredentials, null)
  assert.equal(saved.accountAutoLogin, false)
  assert.equal(JSON.stringify(saved).includes('frontend-user'), false)
  const reloaded = persistence.merge(saved, store.getState())
  assert.equal(reloaded.accountAutoLogin, false)
  store.getState().logout()
  store.getState().setSharedAccount({...account, rememberMe:true})
  assert.equal(store.getState().savedCredentials.rememberMe, false)
})
test('existing frontend opt-out survives the first native identity migration', () => {
  const {store,persistence} = setup()
  const migrated = persistence.merge({savedCredentials:{username:'frontend-user',serverType:'stu',rememberMe:false,passwordSaved:true}}, store.getState())
  assert.equal(migrated.accountAutoLogin, false)
  assert.equal(migrated.savedCredentials.username, 'frontend-user')
})
