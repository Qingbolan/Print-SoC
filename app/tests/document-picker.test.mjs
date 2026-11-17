import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/lib/documents.ts', import.meta.url), 'utf8')
function picker(response, selection) {
  const calls = []
  const exports = {}
  const api = {
    safeInvoke: async command => { calls.push(command); return response },
    safeDialogOpen: async options => { calls.push(options); return selection },
  }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: name => { assert.equal(name, '@/lib/tauri-utils'); return api },
  })
  return { browse: exports.browseDocument, calls }
}
test('browse opens one native picker with backend formats and returns the selected path', async () => {
  const { browse, calls } = picker({ success: true, data: ['pdf', 'pptx', 'jpg'] }, '/tmp/example.pdf')
  assert.equal(await browse(), '/tmp/example.pdf')
  assert.equal(calls[0], 'document_extensions')
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { multiple: false, filters: [{ name: 'Printable documents', extensions: ['pdf', 'pptx', 'jpg'] }] })
})
test('cancellation is distinct from format discovery failure', async () => {
  assert.equal(await picker({ success: true, data: ['pdf'] }, null).browse(), null)
  const failed = picker({ success: false, error: 'Formats unavailable' }, '/tmp/example.pdf')
  await assert.rejects(failed.browse(), /Formats unavailable/)
  assert.equal(failed.calls.length, 1)
})
