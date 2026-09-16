import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isEqual } from 'es-toolkit'
import * as v from 'valibot'

import { ARTIFACT_TRANSFER_TIMEOUT_MS, releaseCommands } from './commands.ts'
import { createReleaseContext } from './context.ts'
import { digestFile } from './manifest.ts'

const { identity, repository, paths } = createReleaseContext()
const { git, github } = releaseCommands(paths.root)
const releaseSchema = v.object({
  id: v.number(),
  tag_name: v.string(),
  draft: v.boolean(),
  assets: v.array(v.object({ name: v.string() }))
})

const releases = v
  .parse(
    v.array(v.array(releaseSchema)),
    JSON.parse(await github(['api', '--paginate', '--slurp', `repos/${repository}/releases`]))
  )
  .flat()
const release = releases.find((entry) => entry.tag_name === identity.tag)
if (release && !release.draft) throw new Error('Refusing to replace a published release')

// Re-fetch the tag and peel annotated tags before any registry/release mutation.
await git('fetch', 'origin', `refs/tags/${identity.tag}`)
const actualCommit = await git('rev-parse', 'FETCH_HEAD^{commit}')
if (actualCommit !== identity.sourceCommit) throw new Error('Release tag changed during the build')

const names = (await readdir(paths.output)).sort()

if (!names.includes('release-manifest.json') || !names.includes('SHA256SUMS')) {
  throw new Error('Missing release manifest')
}

const unexpected = release?.assets.filter((asset) => !names.includes(asset.name)) ?? []
if (unexpected.length > 0) {
  throw new Error(
    `Refusing to remove unexpected draft assets: ${unexpected.map((asset) => asset.name).join(', ')}`
  )
}

if (process.argv[2] === 'check') {
  console.log('Draft and immutable tag verified before publication')
  process.exit(0)
}

if (process.argv[2] !== 'upload') throw new Error('Expected check or upload')

if (!release) {
  await github([
    'release',
    'create',
    identity.tag,
    '--repo',
    repository,
    '--draft',
    '--verify-tag',
    '--title',
    identity.tag,
    '--notes-file',
    paths.notes
  ])
} else {
  await github([
    'release',
    'edit',
    identity.tag,
    '--repo',
    repository,
    '--title',
    identity.tag,
    '--notes-file',
    paths.notes
  ])
}

// Every asset is replaced, never skipped merely because its name already exists.
// GitHub has no atomic multi-asset upload. The release remains draft on failure.
await github(
  [
    'release',
    'upload',
    identity.tag,
    ...names.map((name) => join(paths.output, name)),
    '--repo',
    repository,
    '--clobber'
  ],
  ARTIFACT_TRANSFER_TIMEOUT_MS
)

const remote = v.parse(
  v.object({ isDraft: v.boolean(), assets: v.array(v.object({ name: v.string() })) }),
  JSON.parse(
    await github([
      'release',
      'view',
      identity.tag,
      '--repo',
      repository,
      '--json',
      'isDraft,assets'
    ])
  )
)
const remoteNames = remote.assets.map((asset) => asset.name).sort()

if (!remote.isDraft || !isEqual(remoteNames, names)) {
  throw new Error('Uploaded asset set mismatch')
}

const temporary = await mkdtemp(join(tmpdir(), 'open-pencil-release-verify-'))

try {
  await github(
    ['release', 'download', identity.tag, '--repo', repository, '--dir', temporary],
    ARTIFACT_TRANSFER_TIMEOUT_MS
  )

  for (const name of names) {
    if (
      (await digestFile(join(temporary, name))).sha256 !==
      (await digestFile(join(paths.output, name))).sha256
    ) {
      throw new Error(`Uploaded digest mismatch: ${name}`)
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

console.log(`Draft ${identity.tag} contains only the verified assets from this run`)
