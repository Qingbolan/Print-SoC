import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
const exports = {}
const source = readFileSync(new URL('../src/lib/document-state.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports })
test('only a successfully prepared document can cross the submission boundary', () => {
  assert.throws(() => exports.requireReadyDocument({state:'preparing'}), /Wait for document/)
  assert.throws(() => exports.requireReadyDocument({state:'failed',error:'Conversion failed'}), /Conversion failed/)
  const ready = {state:'ready',path:'/cache/converted.pdf'}
  assert.equal(exports.requireReadyDocument(ready), ready)
})
