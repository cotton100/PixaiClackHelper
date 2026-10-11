import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { prepareUpdate } from '../scripts/prepare-pixais-update.mjs'
import { parseManifest } from '../src/shared/pixai/updates'

it('generates matching per-release update metadata, including prereleases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pixais-metadata-test-'))
  try {
    await mkdir(join(dir, 'src/shared/pixai'), { recursive: true })
    await mkdir(join(dir, 'dist'))
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '0.1.3-beta.1' }))
    await writeFile(
      join(dir, 'src/shared/pixai/updates.ts'),
      'export const DATA_EPOCH = 1\nexport const DATABASE_VERSION = 18'
    )
    const name = 'PixaiClackHelper-0.1.3-beta.1-setup.exe'
    await writeFile(join(dir, 'dist', name), 'fixture bytes')
    await prepareUpdate(dir)
    const manifest = parseManifest(
      JSON.parse(await readFile(join(dir, 'dist/pixais-update.json'), 'utf8')),
      '0.1.3-beta.1'
    )
    const yml = parse(await readFile(join(dir, 'dist/latest.yml'), 'utf8'))
    expect(manifest.sha512).toBe(createHash('sha512').update('fixture bytes').digest('base64'))
    expect(yml).toMatchObject({
      version: manifest.version,
      path: name,
      files: [{ url: name, sha512: manifest.sha512, size: manifest.size }]
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
