#!/usr/bin/env node
/**
 * Fails when apps/web/public/openapi.json and the Hono routes disagree.
 * Run after adding or renaming a route: node scripts/check-openapi.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ROUTES = path.join(ROOT, 'apps/api/src/routes')
const SPEC = path.join(ROOT, 'apps/web/public/openapi.json')

const index = readFileSync(path.join(ROOT, 'apps/api/src/index.ts'), 'utf8')
const prefixes = new Map()
for (const [, mount, name] of index.matchAll(/app\.route\('([^']+)',\s*(\w+)\)/g)) {
  prefixes.set(name, mount)
}

const actual = new Set()
for (const file of readdirSync(ROUTES)) {
  const source = readFileSync(path.join(ROUTES, file), 'utf8')
  const router = source.match(/export const (\w+) = new Hono/)?.[1]
  const prefix = prefixes.get(router)
  if (!prefix) throw new Error(`No mount point for ${router} (${file}) in index.ts`)
  // Only calls on the router itself; `c.get('user')` is a context read, not a route.
  for (const [, method, route] of source.matchAll(new RegExp(`\\b${router}\\.(get|post|put|patch|delete)\\('([^']+)'`, 'g'))) {
    const suffix = route === '/' ? '' : route.replace(/:(\w+)/g, '{$1}')
    actual.add(`${method.toUpperCase()} ${prefix}${suffix}`)
  }
}

const spec = JSON.parse(readFileSync(SPEC, 'utf8'))
const documented = new Set()
for (const [route, item] of Object.entries(spec.paths)) {
  for (const method of Object.keys(item)) documented.add(`${method.toUpperCase()} ${route}`)
}
for (const [, method, route] of index.matchAll(/app\.(get)\('([^']+)'/g)) {
  actual.add(`${method.toUpperCase()} ${route}`)
}

const missing = [...actual].filter((route) => !documented.has(route)).sort()
const extra = [...documented].filter((route) => !actual.has(route)).sort()

// A dangling $ref makes a spec viewer fail to render, so catch it here.
const dangling = new Set()
const walk = (node) => {
  if (Array.isArray(node)) return node.forEach(walk)
  if (!node || typeof node !== 'object') return
  if (typeof node.$ref === 'string') {
    const target = node.$ref.replace(/^#\//, '').split('/')
    if (!target.reduce((acc, key) => acc?.[key], spec)) dangling.add(node.$ref)
  }
  Object.values(node).forEach(walk)
}
walk(spec)

for (const ref of dangling) console.error(`dangling $ref: ${ref}`)
const problems = missing.length + extra.length + dangling.size
for (const route of missing) console.error(`missing from spec: ${route}`)
for (const route of extra) console.error(`not a real route:  ${route}`)
console.log(`${actual.size} routes, ${documented.size} documented, ${problems} problems`)
process.exit(problems === 0 ? 0 : 1)
