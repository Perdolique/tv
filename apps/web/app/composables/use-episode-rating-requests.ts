import { onScopeDispose } from 'vue'

interface EpisodeRatingRequest {
  controller: AbortController;
  revision: number;
}

// Batch reads and single-episode operations must not overwrite newer intent.
function useEpisodeRatingRequests() {
  const active = new Map<string, EpisodeRatingRequest>()
  const revisions = new Map<string, number>()
  let revision = 0

  function start(key: string): EpisodeRatingRequest {
    active.get(key)?.controller.abort()

    revision += 1

    const controller = new globalThis.AbortController()

    const request = {
      controller,
      revision
    }

    active.set(key, request)
    revisions.set(key, revision)

    return request
  }

  function isCurrent(key: string, request: EpisodeRatingRequest): boolean {
    return active.get(key) === request && !request.controller.signal.aborted
  }

  function finish(key: string, request: EpisodeRatingRequest): boolean {
    if (!isCurrent(key, request)) {
      return false
    }

    active.delete(key)

    revision += 1

    revisions.set(key, revision)

    return true
  }

  function canApplyBatch(episodeId: string, batchRevision: number): boolean {
    if (active.has(episodeId)) {
      return false
    }

    const latestRevision = revisions.get(episodeId) ?? 0

    return latestRevision <= batchRevision
  }

  function cancel(): void {
    for (const request of active.values()) {
      request.controller.abort()
    }

    active.clear()
    revisions.clear()
  }

  onScopeDispose(cancel)

  return {
    start,
    isCurrent,
    finish,
    canApplyBatch,
    cancel
  }
}

export { useEpisodeRatingRequests }
