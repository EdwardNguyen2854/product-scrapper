import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const electronDir = join(root, 'node_modules', 'electron')
const pathFile = join(electronDir, 'path.txt')
const installer = join(electronDir, 'install.js')

if (existsSync(pathFile)) {
  console.log('Electron runtime: OK')
  process.exit(0)
}

if (!existsSync(installer)) {
  console.error('ERROR: Electron npm package is missing. Run npm install first.')
  process.exit(1)
}

const env = { ...process.env }
const hasProxy = !!(
  env.HTTPS_PROXY || env.https_proxy ||
  env.HTTP_PROXY || env.http_proxy
)
if (!env.ELECTRON_GET_USE_PROXY && hasProxy) {
  env.ELECTRON_GET_USE_PROXY = '1'
  console.log('Electron runtime is missing; proxy variables detected, enabling ELECTRON_GET_USE_PROXY=1 for this repair.')
} else {
  console.log('Electron runtime is missing; running Electron installer...')
}

const result = spawnSync(process.execPath, [installer], {
  cwd: root,
  env,
  stdio: 'inherit'
})

if (result.status !== 0 || !existsSync(pathFile)) {
  console.error('ERROR: Electron runtime installation did not complete.')
  console.error('If you are behind a corporate proxy, set ELECTRON_GET_USE_PROXY=1 and ensure HTTP_PROXY/HTTPS_PROXY are available.')
  process.exit(result.status || 1)
}

console.log('Electron runtime repaired successfully.')
