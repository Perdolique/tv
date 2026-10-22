import type { CatalogViewingStatus } from '@tv/shared/catalog-viewings'

interface ViewingStatusPresentation {
  label: string;
  icon: string;
  tone: 'neutral' | 'success' | 'info' | 'warning';
}

const viewingStatusPresentation = {
  watching: {
    label: 'Watching',
    icon: 'hugeicons:play-circle',
    tone: 'info'
  },

  paused: {
    label: 'Paused',
    icon: 'hugeicons:pause-circle',
    tone: 'warning'
  },

  dropped: {
    label: 'Dropped',
    icon: 'hugeicons:stop-circle',
    tone: 'neutral'
  },

  completed: {
    label: 'Completed',
    icon: 'hugeicons:checkmark-circle-02',
    tone: 'success'
  }
} satisfies Record<CatalogViewingStatus, ViewingStatusPresentation>

export { viewingStatusPresentation }
