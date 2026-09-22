import * as v from 'valibot'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stdout } from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalogEpisodeSources } from '../catalog-episode-sources.ts'
import { episodeSnapshotSchema, renderEpisodeMigration } from '../catalog-episode-snapshot.ts'

const cliArguments = vi.hoisted(() => ['node', 'generate-catalog-episodes.ts'])

vi.mock(import('node:process'), async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    argv: cliArguments
  }
})

vi.mock(import('node:timers/promises'), () => {
  return { setTimeout: vi.fn() }
})

const fetchMock = vi.fn<typeof globalThis.fetch>()

const directories = {
  temporary: '',
  output: ''
}

describe('manual episode generator output', () => {
  beforeEach(async () => {
    vi.resetModules()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(stdout, 'write').mockReturnValue(true)

    directories.temporary = await mkdtemp('/tmp/tv-episode-generator-')
    directories.output = join(directories.temporary, 'output')

    cliArguments.splice(2, cliArguments.length - 2, directories.output)

    for (const source of catalogEpisodeSources) {
      const body = JSON.stringify({
        id: source.showId,
        name: source.title,
        premiered: source.premiered,
        language: source.language,

        _embedded: {
          episodes: [{
            id: source.showId,
            season: source.seasonRestriction ?? 1,
            number: 1,
            type: 'regular',
            name: 'Episode one',
            airdate: source.premiered
          }]
        }
      })

      const response = new globalThis.Response(body)

      fetchMock.mockResolvedValueOnce(response)
    }
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()

    await rm(directories.temporary, {
      recursive: true,
      force: true
    })
  })

  it('rejects an existing directory before any request and preserves its files', async () => {
    // Arrange
    await mkdir(directories.output)

    const existingSnapshot = join(directories.output, 'snapshot.json')

    await writeFile(existingSnapshot, 'reviewed snapshot')

    // Act
    const generation = import('../generate-catalog-episodes.ts')

    // Assert
    await expect(generation).rejects.toBeInstanceOf(Error)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(generation).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(readFile(existingSnapshot, 'utf8')).resolves.toBe('reviewed snapshot')
  })

  it('rejects a missing parent before any request', async () => {
    // Arrange
    const missingParentOutput = join(directories.temporary, 'missing', 'output')

    cliArguments[2] = missingParentOutput

    // Act
    const generation = import('../generate-catalog-episodes.ts')

    // Assert
    await expect(generation).rejects.toMatchObject({ code: 'ENOENT' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves the HTTP failure cause and explains how to retry', async () => {
    // Arrange
    const response = new globalThis.Response(null, { status: 503 })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(response)

    // Act
    const generation = import('../generate-catalog-episodes.ts')

    // Assert
    await expect(generation).rejects.toMatchObject({
      message: `Episode generation failed. Files in ${directories.output} may be incomplete. Discard this output and retry with a new directory.`,
      cause: { message: 'TVMaze returned 503 for https://api.tvmaze.com/shows/716?embed=episodes; retry the generator later' }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(readdir(directories.output)).resolves.toStrictEqual([])
  })

  it('reports incomplete output and the original cause when writing SQL fails', async () => {
    // Arrange
    const conflictPath = join(directories.output, 'migration.sql')
    const snapshotPath = join(directories.output, 'snapshot.json')

    // Add a conflicting entry after the generator reserves the output directory.
    const fetchWithConflict = vi.fn<typeof globalThis.fetch>()

    fetchWithConflict.mockImplementation(fetchMock)

    fetchWithConflict.mockImplementationOnce(async (...arguments_) => {
      await mkdir(conflictPath)

      return fetchMock(...arguments_)
    })

    vi.stubGlobal('fetch', fetchWithConflict)

    // Act
    const generation = import('../generate-catalog-episodes.ts')

    // Assert
    await expect(generation).rejects.toMatchObject({
      cause: { code: 'EISDIR' }
    })

    await expect(generation).rejects.toThrow('may be incomplete')
    expect(fetchMock).toHaveBeenCalledTimes(catalogEpisodeSources.length)

    const serialized = await readFile(snapshotPath, 'utf8')
    const snapshot = v.parse(episodeSnapshotSchema, JSON.parse(serialized))

    expect(snapshot.series).toHaveLength(catalogEpisodeSources.length)
  })

  it('writes a validated snapshot and matching static SQL for every mapped series', async () => {
    // Arrange
    const snapshotPath = join(directories.output, 'snapshot.json')
    const migrationPath = join(directories.output, 'migration.sql')

    // Act
    await import('../generate-catalog-episodes.ts')

    const serialized = await readFile(snapshotPath, 'utf8')
    const snapshot = v.parse(episodeSnapshotSchema, JSON.parse(serialized))
    const expectedMigration = renderEpisodeMigration(snapshot)
    const sources = snapshot.series.map(series => series.source)

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(catalogEpisodeSources.length)
    expect(sources).toStrictEqual(catalogEpisodeSources)
    await expect(readFile(migrationPath, 'utf8')).resolves.toBe(expectedMigration)
  })
})
