<template>
  <section :class="$style.component" aria-label="Collection management">
    <NuxtLink :class="$style.link" to="/manage/collections/new">Create collection</NuxtLink>
    <div v-if="hasError" :class="$style.message">
      <AppMessage role="alert" tone="danger">We couldn’t load your collections.</AppMessage>
      <AppButton size="small" :disabled="isLoading" variant="secondary" @click="retry">Try again</AppButton>
    </div>
    <p v-if="initialLoading" role="status">Loading collections…</p>
    <ul v-if="data" :class="$style.list">
      <li v-for="collection in rows" :key="collection.id" :class="$style.row">
        <div><h2 ref="collectionHeadings" tabindex="-1">{{ collection.title }}</h2><p>{{ collection.visibility }}</p></div>
        <NuxtLink :class="$style.link" :to="collection.editLocation">Edit</NuxtLink>
        <NuxtLink :class="$style.link" :to="collection.location">View collection</NuxtLink>
      </li>
    </ul>
    <p v-if="isEmpty" ref="emptyState" tabindex="-1">No collections yet. Create one to start grouping titles.</p>
    <nav :class="$style.pagination" aria-label="Collection pages">
      <NuxtLink v-if="previousLocation" :class="$style.link" :to="previousLocation">Previous page</NuxtLink>
      <NuxtLink v-if="nextLocation" :class="$style.link" :to="nextLocation">Next page</NuxtLink>
    </nav>
  </section>
</template>

<script setup lang="ts">
  import { computed, useTemplateRef } from 'vue'
  import { collectionListSchema } from '@tv/shared/catalog-discovery'
  import { useCatalogRead } from '~/composables/use-catalog-read.ts'
  import { useRecoveryFocus } from '~/composables/use-recovery-focus.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    page: number;
  }

  const { page } = defineProps<Props>()
  const endpoint = `/api/catalog/manage/collections?page=${page}`
  const key = `manage-collections:${page}`
  const { data, ready, hasError, isLoading } = useCatalogRead(key, endpoint, { schema: collectionListSchema })
  const { capture } = useRecoveryFocus()
  const collectionHeadings = useTemplateRef('collectionHeadings')
  const emptyState = useTemplateRef('emptyState')
  const initialLoading = computed(() => isLoading.value && data.value === undefined)
  const isEmpty = computed(() => data.value?.collections.length === 0)
  const previousLocation = computed(() => page > 1 ? `/manage/collections?page=${page - 1}` : null)
  const nextLocation = computed(() => data.value?.nextPage ? `/manage/collections?page=${data.value.nextPage}` : null)

  const rows = computed(() => data.value?.collections.map(collection => {
    const visibility = collection.isFeatured ? 'Featured on home' : 'Available on title pages'
    const editLocation = `/manage/collections/${collection.id}`
    const location = `/collections/${collection.id}`

    return {
      id: collection.id,
      title: collection.title,
      visibility,
      editLocation,
      location
    }
  }) ?? [])

  async function retry(event: MouseEvent): Promise<void> {
    if (isLoading.value) { return }

    const restoreFocus = capture(event)

    await ready.execute()

    if (!hasError.value) { await restoreFocus(() => collectionHeadings.value?.[0] ?? emptyState.value) }
  }

  await ready
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-5); }
    .list { list-style: none; padding: 0; }
    .row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-4); padding-block: var(--space-5); border-bottom: 1px solid var(--color-border); }
    .row > div { flex: 1; }
    .row h2 { font-size: 1.125rem; font-weight: 600; }
    .row p { color: var(--color-text-secondary); font-size: 0.875rem; }
    .link { justify-self: start; }
    .message, .pagination { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
  }
</style>
