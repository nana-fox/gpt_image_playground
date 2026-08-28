import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Studio container builds the Studio flavor and runs without root or bundled secrets', async () => {
  const source = await readFile(new URL('../deploy/studio.Dockerfile', import.meta.url), 'utf8')
  const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(source, /npm run build:studio/)
  assert.match(source, /ARG STUDIO_BASE_PATH/)
  assert.match(vite, /VITE_STUDIO_BASE_PATH/)
  assert.match(source, /STUDIO_STATIC_ROOT=\/app\/dist/)
  assert.match(source, /COPY --from=build \/app\/package\.json \/app\/package-lock\.json \.\//)
  assert.match(source, /npm ci --omit=dev/)
  assert.match(source, /USER studio/)
  assert.match(source, /HEALTHCHECK/)
  assert.match(source, /\/api\/ready/)
  assert.match(source, /studio-server\/server\.mjs/)
  assert.doesNotMatch(styles, /@import url\(['"]http/)
  assert.doesNotMatch(source, /ROUTER_AUTH_CURRENT_SECRET=/)
  assert.doesNotMatch(source, /ROUTER_IMAGE_API_KEY=/)
})

test('Studio CI requires PostgreSQL tests and smoke tests the real container', async () => {
  const workflow = await readFile(new URL('../.github/workflows/studio-ci.yml', import.meta.url), 'utf8')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(workflow, /node-version: 24/)
  assert.match(workflow, /postgres:18-alpine/)
  assert.match(workflow, /npm run test:studio-server:ci/)
  assert.match(workflow, /deploy\/studio\.Dockerfile/)
  assert.match(workflow, /\/api\/health/)
  assert.match(workflow, /\/api\/ready/)
  assert.match(workflow, /NanaFox Studio/)
  assert.match(pkg.scripts['test:studio-server:ci'], /STUDIO_TEST_DATABASE_URL/)
  assert.match(pkg.scripts['test:studio-server:ci'], /test-coverage-lines=80/)
})
