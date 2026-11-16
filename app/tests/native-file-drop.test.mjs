import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/hooks/useNativeFileDrop.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function harness() {
  const effects = []
  const states = []
  const drops = []
  let listener
  let releaseCount = 0
  let resolveRegistration
  const registration = new Promise(resolve => { resolveRegistration = resolve })
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    console,
    require(name) {
      if (name === 'react') return {
        useEffect: effect => effects.push(effect),
        useRef: current => ({ current }),
        useState: initial => [initial, value => states.push(value)],
      }
      if (name === '@/lib/tauri-utils') return { isTauriAvailable: () => true }
      if (name === '@tauri-apps/api/webviewWindow') return {
        getCurrentWebviewWindow: () => ({
          onDragDropEvent(callback) { listener = callback; return registration },
        }),
      }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  exports.useNativeFileDrop(paths => drops.push(paths))
  const cleanup = effects.map(effect => effect()).filter(Boolean)
  return {
    states, drops,
    emit: payload => listener({ payload }),
    dispose: () => cleanup.forEach(dispose => dispose()),
    finishRegistration: () => resolveRegistration(() => { releaseCount++ }),
    get releaseCount() { return releaseCount },
    get registered() { return Boolean(listener) },
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('late registration releases the listener and ignores events after unmount', async () => {
  const h = harness()
  await flush()
  h.dispose()
  h.emit({ type: 'drop', paths: ['/tmp/stale.pdf'] })
  h.finishRegistration()
  await flush()
  assert.equal(h.releaseCount, 1)
  assert.deepEqual(h.drops, [])
  assert.deepEqual(h.states, [])
})

test('unmount before module import does not register a listener', async () => {
  const h = harness()
  h.dispose()
  await flush()
  assert.equal(h.registered, false)
})

test('drag, leave and drop update feedback and release the active listener', async () => {
  const h = harness()
  await flush()
  h.finishRegistration()
  await flush()
  h.emit({ type: 'enter', paths: ['/tmp/test.pdf'] })
  h.emit({ type: 'leave' })
  h.emit({ type: 'over' })
  h.emit({ type: 'drop', paths: ['/tmp/test.pdf'] })
  assert.deepEqual(h.states, [true, false, true, false])
  assert.deepEqual(h.drops, [['/tmp/test.pdf']])
  h.dispose()
  assert.equal(h.releaseCount, 1)
})
