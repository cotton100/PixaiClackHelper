import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(version)
)
  throw new Error('Invalid release version')
const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--dir')) throw new Error('Unsupported build argument')
const config = version.includes('-') ? 'electron-builder.beta.yml' : 'electron-builder.yml'
const result = spawnSync(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--config',
    config,
    '--win',
    '--publish',
    'never',
    ...args
  ],
  { stdio: 'inherit', windowsHide: true }
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
