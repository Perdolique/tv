<template>
  <section :class="$style.component" aria-label="Search results">
    <p role="status" aria-live="polite" :class="$style.status">{{ announcement }}</p>
    <div v-if="hasFailure" :class="$style.failure">
      <AppMessage role="alert" tone="danger">
        We couldn’t search for “{{ failure }}”. {{ failureHint }}
      </AppMessage>
      <AppButton :disabled="isLoading" variant="secondary" @click="emit('retry')">Try again</AppButton>
    </div>
    <div v-if="showSkeleton" :class="$style.skeleton" aria-hidden="true">
      <div v-for="row in 3" :key="row" :class="$style.skeletonRow" />
    </div>
    <template v-if="hasResult">
      <h2 :class="$style.heading">Results for “{{ resultQuery }}”</h2>
      <ul v-if="hasItems" :class="$style.list" :aria-busy="isLoading">
        <li v-for="item in rows" :key="item.id" :class="$style.row">
          <h3 :class="$style.title">{{ item.title }}</h3>
          <p :class="$style.metadata">{{ item.metadata }}</p>
        </li>
      </ul>
      <div v-else :class="$style.empty">
        <h3>No titles found</h3>
        <p>Try another title or a different spelling.</p>
      </div>
    </template>
  </section>
</template>

<script lang="ts" setup>
  import type { CatalogSearchItem } from '@tv/shared/catalog'
  import { computed } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    failure: string;
    isLoading: boolean;
    items?: CatalogSearchItem[];
    resultQuery?: string;
  }

  const { failure, isLoading, items, resultQuery } = defineProps<Props>()
  const emit = defineEmits<{ retry: [] }>()
  const hasFailure = computed(() => failure !== '')
  const hasResult = computed(() => resultQuery !== undefined)
  const hasItems = computed(() => items !== undefined && items.length > 0)
  const showSkeleton = computed(() => isLoading && !hasResult.value)
  const failureHint = computed(() => hasResult.value ? 'Your previous results are still shown below.' : 'Try again.')

  const rows = computed(() => items?.map((item) => {
    const type = item.type === 'movie' ? 'Movie' : 'Series'
    const metadata = item.releaseYear === null ? type : `${type} · ${item.releaseYear}`

    return {
      id: item.id,
      title: item.title,
      metadata
    }
  }))

  const announcement = computed(() => {
    if (isLoading) {
      return hasResult.value ? 'Updating results…' : 'Searching…'
    }

    if (hasFailure.value) {
      return 'Search could not be updated.'
    }

    if (hasResult.value) {
      const count = items?.length ?? 0
      const label = count === 1 ? 'title' : 'titles'

      return `${count} ${label} found.`
    }

    return 'Enter a movie or series title to start exploring.'
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      gap: var(--space-5);
    }
    .failure {
      display: grid;
      justify-items: start;
      gap: var(--space-3);
    }
    .status, .metadata {
      color: var(--color-text-secondary);
    }
    .heading {
      font-size: 1.375rem;
      font-weight: 600;
    }
    .list {
      display: grid;
      padding: 0;
      list-style: none;
    }
    .row {
      display: grid;
      gap: var(--space-1);
      padding-block: var(--space-5);
      border-block-end: 1px solid var(--color-border);
    }
    .title {
      font-size: 1rem;
      font-weight: 600;
    }
    .metadata {
      font-size: 0.875rem;
    }
    @media (width >= 40rem) {
      .heading {
        font-size: 1.5rem;
      }
    }
    .empty {
      display: grid;
      gap: var(--space-2);
      padding-block: var(--space-8);
    }
    .skeleton {
      display: grid;
      gap: var(--space-3);
    }
    .skeletonRow {
      block-size: 5rem;
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
    }
  }
</style>
