import type { CatalogTimelineItem } from '@tv/shared/catalog-timeline'

// A day's episode group keeps its identity when its newest mark is removed.
function timelineItemKey(item: CatalogTimelineItem): string {
  if (item.kind === 'episode_group') { return `episode_group:${item.viewingId}:${item.localDate}` }

  return item.id
}

export { timelineItemKey }
