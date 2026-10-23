<template>
  <section :class="$style.component" :aria-busy="loading">
    <AppMessage v-if="errorMessage" role="alert" tone="danger">{{ errorMessage }}</AppMessage>
    <AppButton v-if="errorMessage" :disabled="loading" variant="secondary" @click="load(page)">Try again</AppButton>
    <p v-if="loading" role="status">Loading requests…</p>
    <p v-if="isEmpty">{{ emptyMessage }}</p>
    <ol :class="$style.list"><li v-for="item in rows" :key="item.id"><RequestCard :card="item.card">
      <p>{{ item.statusLabel }}</p><p>{{ item.createdLabel }}</p>
      <p v-if="manager">{{ item.countLabel }}</p>
      <NuxtLink v-if="item.location" :to="item.location">{{ item.actionLabel }}</NuxtLink>
    </RequestCard></li></ol>
    <nav :class="$style.navigation" aria-label="Request pages"><AppButton v-if="hasPrevious" :disabled="loading" variant="secondary" @click="load(page - 1)">Previous</AppButton><AppButton v-if="nextPage" :disabled="loading" variant="secondary" @click="load(nextPage)">Next</AppButton></nav>
  </section>
</template>
<script setup lang="ts">
  import { useRequestFetch } from '#app'
  import { ref, shallowRef, toRef, watch } from 'vue'
  import * as v from 'valibot'
  import { titleRequestPageSchema, type TitleRequest } from '@tv/shared/catalog-requests'
  import RequestCard from '~/components/requests/RequestCard.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useCatalogImportAccess } from '~/composables/use-catalog-import-access.ts'
  import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'

  interface Props {
    manager?: boolean;
  }

  const { manager } = defineProps<Props>()
  const requestFetch = useRequestFetch()
  const { state, setAnonymous } = useAuthSession()
  const { canManage, deny } = useCatalogImportAccess()
  const cancellation = useRequestCancellation()
  const items = ref<TitleRequest[]>([])
  const page = shallowRef(1)
  const nextPage = shallowRef<number | null>(null)
  const loading = shallowRef(false)
  const errorMessage = shallowRef('')
  const accountId = toRef(() => state.value.status === 'authenticated' ? state.value.user.id : null)
  const allowed = toRef(() => accountId.value !== null && (!manager || canManage.value))
  const isEmpty = toRef(() => allowed.value && !loading.value && !errorMessage.value && items.value.length === 0)
  const emptyMessage = toRef(() => manager ? 'No pending requests.' : 'You have no title requests yet.')
  const hasPrevious = toRef(() => page.value > 1)

  const rows = toRef(() => items.value.map(item => {
    const statusLabel = item.status === 'available' ? 'Added to catalog' : 'Pending'
    const createdAt = new Date(item.createdAt)
    const createdDate = createdAt.toLocaleDateString('en-GB', { timeZone: 'UTC' })
    const createdLabel = `Requested ${createdDate}`
    const requesterLabel = item.requesterCount === 1 ? 'requester' : 'requesters'
    const countLabel = `${item.requesterCount} ${requesterLabel}`
    const titlePath = `/titles/${item.catalogItemId}`
    const catalogLocation = item.catalogItemId === null ? null : { path: titlePath }

    const importLocation = {
      path: '/manage/imports',

      query: {
        type: item.card.type,
        tmdbId: item.card.tmdbId
      }
    }

    const location = manager ? importLocation : catalogLocation
    const actionLabel = manager ? 'Review import' : 'Open title'

    return {
      id: item.id,
      card: item.card,
      statusLabel,
      createdLabel,
      countLabel,
      location,
      actionLabel
    }
  }))

  async function load(target: number): Promise<void> {
    if (!allowed.value) { return }

    const controller = cancellation.start()

    loading.value = true
    errorMessage.value = ''

    try {
      const endpoint = manager ? '/api/catalog/manage/requests' : '/api/catalog/requests'

      const raw = await requestFetch(endpoint, {
        query: { page: target },
        signal: controller.signal,
        retry: 0
      })

      const response = v.parse(titleRequestPageSchema, raw)

      if (!cancellation.isCurrent(controller)) { return }

      items.value = response.items
      nextPage.value = response.nextPage
      page.value = target
    } catch (error) {
      if (cancellation.isCurrent(controller)) {
        errorMessage.value = 'We couldn’t load requests. Try again.'

        const parsed = v.safeParse(v.object({
          statusCode: v.optional(v.number()),
          status: v.optional(v.number())
        }), error)

        const status = parsed.success ? parsed.output.statusCode ?? parsed.output.status : null

        if (status === 401) { setAnonymous() }

        if (manager && status === 403) { deny() }
      }
    } finally { if (cancellation.finish(controller)) { loading.value = false } }
  }

  watch([accountId, allowed], () => {
    cancellation.cancel()

    items.value = []
    nextPage.value = null
    loading.value = false
    errorMessage.value = ''
    page.value = 1

    if (allowed.value) { void load(1) }
  }, { flush: 'sync' })

  if (allowed.value) { await load(1) }

</script>
<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-5); min-inline-size: 0; }
    .list { display: grid; gap: var(--space-5); padding: 0; list-style: none; }
    .navigation { display: flex; gap: var(--space-3); }
  }
</style>
