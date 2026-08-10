import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const violations = []

const rules = [
  {
    name: 'Use the mapped typography scale',
    pattern: /text-(?:5xl|6xl|7xl|8xl|9xl)|text-\[(?:\d+(?:\.\d+)?)(?:px|rem|em)\]/g,
  },
  {
    name: 'Do not use decorative blur in route pages',
    pattern: /backdrop-blur(?:-[\w[\]/.-]+)?/g,
    pagesOnly: true,
  },
  {
    name: 'Route pages must not impose maximum dimensions',
    pattern: /\bmax-(?:w|h)-(?!none\b)[\w[\]()./%-]+/g,
    pagesOnly: true,
  },
  {
    name: 'Route layouts must not use arbitrary fixed dimensions',
    pattern: /\b(?:min-|max-)?(?:w|h)-\[(?!var\(|calc\()[^\]]+\]/g,
    pagesOnly: true,
  },
  {
    name: 'Route grids must use proportional tracks',
    pattern: /grid-cols-\[[^\]]*\d(?:px|rem)[^\]]*\]/g,
    pagesOnly: true,
  },
  {
    name: 'Do not add decorative statistic dividers',
    pattern: /w-px\s+h-8\s+bg-border/g,
    pagesOnly: true,
  },
]

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? walk(path) : path
    }),
  )
  return files.flat()
}

for (const file of await walk(sourceRoot)) {
  if (!['.ts', '.tsx'].includes(extname(file))) continue

  const source = await readFile(file, 'utf8')
  const displayPath = relative(join(sourceRoot, '..'), file)

  if (
    displayPath.startsWith('src/pages/') &&
    displayPath.endsWith('Page.tsx') &&
    !displayPath.endsWith('LoginPage.tsx') &&
    !source.includes('<PageScaffold')
  ) {
    violations.push(`${displayPath}: route pages must use PageScaffold`)
  }

  for (const rule of rules) {
    if (rule.pagesOnly && !displayPath.startsWith('src/pages/')) continue

    for (const match of source.matchAll(rule.pattern)) {
      const line = source.slice(0, match.index).split('\n').length
      violations.push(`${displayPath}:${line} ${rule.name}: ${match[0]}`)
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log('Design-system constraints passed.')
}
