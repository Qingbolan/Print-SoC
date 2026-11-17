import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/data/printers.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText, {exports, require: (name) => JSON.parse(readFileSync(new URL(name.endsWith('printer-aliases.json') ? '../shared/printer-aliases.json' : '../shared/printers.json', import.meta.url), 'utf8'))})
test('all upstream historical queues have known catalogue metadata after alias normalization', () => {
  const queues = ['psts','psts-sx','pstsb','pstsb-sx','pstsc','pstsc-sx','psc008','psc008-sx','psc011','psc011-sx','psc245','psc245-sx']
  for (const queue of queues) assert.ok(exports.PRINTERS.some(p => p.queue_name === exports.normalizePrintQueueName(queue)), queue)
})
test('public catalogue includes colour and additional buildings', () => {
  const names = exports.getPublicPrinters().map(p => p.queue_name)
  for (const queue of ['cptsc','cptsc-a3','pse124','psf204']) assert.ok(names.includes(queue), queue)
})
test('student server discovery does not discard extra or historical queues', () => {
  const found = exports.getAvailablePrintersFromQueues(['psc245','psc245-sx','new-room-dx'], 'stu')
  assert.equal(found.length, 3)
  assert.ok(found.some(p => p.queue_name === 'new-room-dx' && p.status === 'Unknown'))
  assert.equal(exports.PRINTERS.length, new Set(exports.PRINTERS.map(p => p.queue_name)).size)
})
