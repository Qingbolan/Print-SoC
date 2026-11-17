import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/lib/print-preview.ts', import.meta.url), 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports })
const { makeSheets, backRotation, fitPage } = exports

test('19 pages at 9-up duplex produce two physical sheets and a blank final back', () => {
  const sheets = JSON.parse(JSON.stringify(makeSheets(Array.from({length:19}, (_, i) => i + 1), 9, 'DuplexLongEdge')))
  assert.equal(sheets.length, 2)
  assert.deepEqual(sheets[0].front, [1,2,3,4,5,6,7,8,9])
  assert.deepEqual(sheets[0].back, [10,11,12,13,14,15,16,17,18])
  assert.deepEqual(sheets[1], { front:[19], back:[] })
})
test('simplex and noncontiguous selection preserve order without duplicate pages', () => {
  const sheets = JSON.parse(JSON.stringify(makeSheets([8,2,2,4], 2, 'Simplex')))
  assert.deepEqual(sheets, [{front:[2,4],back:[]},{front:[8],back:[]}])
})
test('binding and physical turning direction determine back orientation', () => {
  for (const [orientation, mode, uprightAxis] of [
    ['Portrait','DuplexLongEdge','vertical'], ['Portrait','DuplexShortEdge','horizontal'],
    ['Landscape','DuplexLongEdge','horizontal'], ['Landscape','DuplexShortEdge','vertical'],
  ]) {
    assert.equal(backRotation(mode, orientation, uprightAxis), 0)
    assert.equal(backRotation(mode, orientation, uprightAxis === 'vertical' ? 'horizontal' : 'vertical'), 180)
  }
})
test('landscape slides fill the cell width and portrait pages fit its height', () => {
  assert.equal(fitPage(300, 200, 1600, 900), 300)
  assert.equal(fitPage(300, 200, 600, 900), 200 * 600 / 900)
})

test('booklet pads blanks and pairs outside-in across odd lengths and selections', () => {
  for (let count = 1; count <= 101; count++) {
    const pages = Array.from({length: count}, (_, i) => i * 2 + 1)
    const sheets = exports.makeBookletSheets(pages)
    const flat = sheets.flatMap(sheet => [...sheet.front, ...sheet.back])
    assert.equal(flat.length, Math.ceil(count / 4) * 4)
    assert.deepEqual(Array.from(flat.filter(page => page !== null)).sort((a,b) => a-b), pages)
    for (let i = 0; i < sheets.length; i++) {
      assert.equal(sheets[i].front[1], pages[i * 2])
      assert.equal(sheets[i].back[0], pages[i * 2 + 1] ?? null)
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(exports.makeBookletSheets([1,2,3,4,5]))), [
    {front:[null,1],back:[2,null]}, {front:[null,3],back:[4,5]},
  ])
})

 test('turn selection maps to the actual duplex binding for both paper orientations', () => {
  for (const [orientation, axis, expected] of [
    ['Portrait','vertical','DuplexLongEdge'], ['Portrait','horizontal','DuplexShortEdge'],
    ['Landscape','vertical','DuplexShortEdge'], ['Landscape','horizontal','DuplexLongEdge'],
  ]) {
    assert.equal(exports.duplexForTurn(axis, orientation), expected)
    assert.equal(backRotation(expected, orientation, axis), 0)
  }
})
