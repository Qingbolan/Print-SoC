import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
const exports = {}
const source = readFileSync(new URL('../src/lib/window-resize.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports })
const { resizeWindowBounds } = exports
const bounds = { x: -1500, y: 100, width: 1400, height: 900 }
const plain = value => JSON.parse(JSON.stringify(value))

test('corner resizing preserves the opposite corner, including negative monitor coordinates', () => {
  const next = resizeWindowBounds(bounds, 'nw', 200, -100, 480)
  assert.deepEqual(plain(next), { x: -1300, y: 0, width: 1200, height: 1000 })
  assert.equal(next.x + next.width, bounds.x + bounds.width)
  assert.equal(next.y + next.height, bounds.y + bounds.height)
})
test('minimum size does not move the fixed edge', () => {
  const next = resizeWindowBounds(bounds, 'nw', 2000, 2000, 480)
  assert.deepEqual(plain(next), { x: -580, y: 520, width: 480, height: 480 })
})
test('all edge gestures affect only their requested axes', () => {
  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const next = resizeWindowBounds(bounds, edge, 30, 40, 480)
    assert.equal(next.width, bounds.width + (edge.includes('e') ? 30 : edge.includes('w') ? -30 : 0))
    assert.equal(next.height, bounds.height + (edge.includes('s') ? 40 : edge.includes('n') ? -40 : 0))
  }
})
test('physical-pixel minimum supports Retina displays', () => {
  const next = resizeWindowBounds({ ...bounds, width: 2800, height: 1800 }, 'se', -3000, -3000, 960)
  assert.equal(next.width, 960)
  assert.equal(next.height, 960)
})

test('a new resize waits for prior native writes before reading its origin', async () => {
  let bounds = {x:0,y:0,width:1000,height:800}
  let release
  const barrier = new Promise(resolve => { release = resolve })
  let writes = 0
  let reads = 0
  const errors = []
  const controller = new exports.WindowResizeController({
    async snapshot() { reads++; return {bounds:{...bounds},scale:1} },
    async apply(next) { if (++writes === 1) await barrier; bounds = {...next} },
  }, error => errors.push(error))
  await controller.begin('e', 0, 0, 1)
  controller.move(100, 0, 1)
  controller.end(1)
  const second = controller.begin('e', 100, 0, 2)
  controller.move(150, 0, 2)
  assert.equal(reads, 1)
  release()
  await second
  assert.equal(reads, 2)
  assert.equal(bounds.width, 1150)
  assert.equal(errors.length, 0)
})

test('late snapshots and unrelated pointers cannot mutate a disposed resize', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const writes = []
  const controller = new exports.WindowResizeController({
    async snapshot() { await pending; return {bounds:{x:0,y:0,width:1000,height:800},scale:1} },
    async apply(next) { writes.push(next) },
  }, error => { throw error })
  const starting = controller.begin('e', 0, 0, 1)
  controller.move(500, 0, 99)
  controller.move(100, 0, 1)
  controller.dispose()
  release()
  await starting
  assert.equal(writes.length, 0)
})
