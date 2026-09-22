/* oxlint-disable eslint/no-await-in-loop -- Sequential requests respect TVMaze rate limits. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { argv, stdout } from 'node:process'
import { setTimeout } from 'node:timers/promises'
import { catalogEpisodeSources } from './catalog-episode-sources.ts'
import { createSnapshotSeries, type EpisodeSnapshot, renderEpisodeMigration } from './catalog-episode-snapshot.ts'

const [outputArgument, ...extraArguments] = argv.slice(2)

if (outputArgument === undefined || extraArguments.length > 0) {
  throw new Error('Usage: vp run catalog:episodes:generate <new-output-directory>')
}

const outputDirectory = resolve(outputArgument)

// Reserve a new directory before making requests; never replace a reviewed snapshot.
await mkdir(outputDirectory)

const checkedOn = new Date().toISOString().slice(0, 10)

const snapshot: EpisodeSnapshot = {
  checkedOn,
  series: []
}

try {
  for (const source of catalogEpisodeSources) {
    // Stay below TVMaze's documented minimum of 20 requests per 10 seconds.
    await setTimeout(600)

    const url = `https://api.tvmaze.com/shows/${source.showId}?embed=episodes`

    // oxlint-disable-next-line eslint/no-undef -- AbortSignal is provided by the Node runtime.
    const signal = AbortSignal.timeout(30_000)
    const response = await globalThis.fetch(url, { signal })

    if (!response.ok) {
      throw new Error(`TVMaze returned ${response.status} for ${url}; retry the generator later`)
    }

    const body: unknown = await response.json()
    const series = createSnapshotSeries(source, body)

    snapshot.series.push(series)
    stdout.write(`${source.title} (${source.year}): ${series.episodes.length} regular episodes\n`)
  }

  const migration = renderEpisodeMigration(snapshot)
  const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`

  await writeFile(join(outputDirectory, 'snapshot.json'), serializedSnapshot)
  await writeFile(join(outputDirectory, 'migration.sql'), migration)
} catch (error) {
  throw new Error(
    `Episode generation failed. Files in ${outputDirectory} may be incomplete. Discard this output and retry with a new directory.`,
    { cause: error }
  )
}

stdout.write(`Review snapshot.json and migration.sql in ${outputDirectory}\n`)
