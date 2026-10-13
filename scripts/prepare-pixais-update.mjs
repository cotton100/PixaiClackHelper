/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stringify } from 'yaml'

export async function prepareUpdate(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(
      pkg.version
    )
  )
    throw new Error('Invalid version')
  const source = await readFile(join(root, 'src/shared/pixai/updates.ts'), 'utf8')
  const dataEpoch = Number(source.match(/export const DATA_EPOCH = (\d+)/)?.[1])
  const databaseVersion = Number(source.match(/export const DATABASE_VERSION = (\d+)/)?.[1])
  const minReadableDataEpoch = Number(
    source.match(/export const MIN_READABLE_DATA_EPOCH = (\d+)/)?.[1] ?? dataEpoch
  )
  if (!dataEpoch || !databaseVersion) throw new Error('Missing compatibility metadata')
  const channel = pkg.version.includes('-') ? 'beta' : 'stable'
  const file = `PixaiClackHelper-${channel === 'beta' ? 'Beta-' : ''}${pkg.version}-setup.exe`
  const path = join(root, 'dist', file)
  const size = (await stat(path)).size
  if (!size || size > 1024 ** 3) throw new Error('Invalid installer size')
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const sha512 = hash.digest('base64')
  await writeFile(
    join(root, 'dist/pixais-update.json'),
    JSON.stringify(
      {
        format: 1,
        channel,
        version: pkg.version,
        dataEpoch,
        minReadableDataEpoch,
        databaseVersion,
        file,
        size,
        sha512
      },
      null,
      2
    )
  )
  // Each release has its own latest.yml, including explicitly selected prereleases.
  await writeFile(
    join(root, 'dist/latest.yml'),
    stringify({
      version: pkg.version,
      path: file,
      sha512,
      files: [{ url: file, size, sha512 }],
      releaseDate: new Date().toISOString()
    })
  )
  return { version: pkg.version, file, size }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await prepareUpdate(resolve('.'))))
}
