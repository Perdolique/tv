<template>
  <AppShell @signed-out="navigateTo('/')">
    <main :class="$style.component">
      <NuxtLink :class="$style.back" to="/manage/collections">Manage collections</NuxtLink>
      <h1 :class="$style.heading">{{ title }}</h1>
      <div v-if="hasProtectedContent" v-show="canManage" :class="$style.content" :inert="accessBlocked"><slot /></div>
      <div v-if="accessBlocked" :class="$style.message">
        <AppMessage role="alert">{{ accessMessage }}</AppMessage>
        <AppButton size="small" variant="secondary" @click="check">Check access again</AppButton>
      </div>
    </main>
  </AppShell>
</template>

<script setup lang="ts">
  import { navigateTo } from '#app'
  import { computed, shallowRef, watch } from 'vue'
  import AppShell from '~/components/app/AppShell.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useCatalogImportAccess } from '~/composables/use-catalog-import-access.ts'

  interface Props {
    title: string;
  }

  defineProps<Props>()

  const { accountId, canManage, check, state } = useCatalogImportAccess()
  const retainedAccountId = shallowRef<string | null>(null)
  const hasProtectedContent = computed(() => retainedAccountId.value !== null)
  const accessBlocked = computed(() => !canManage.value)
  const accessMessage = computed(() => state.value.status === 'denied' ? 'You do not have access to catalog management.' : 'We couldn’t verify your catalog access. Try again.')

  watch([accountId, state], ([currentAccountId, access]) => {
    const matchesAccount = access.accountId === currentAccountId

    if (matchesAccount && access.status === 'allowed') {
      retainedAccountId.value = currentAccountId

      return
    }

    const canPreserveDraft = matchesAccount && currentAccountId === retainedAccountId.value && access.status === 'error'

    if (!canPreserveDraft) { retainedAccountId.value = null }
  }, {
    immediate: true,
    flush: 'sync'
  })

</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-6); padding: var(--space-8) var(--layout-page-mobile); }
    .heading { font-size: 2rem; font-weight: 600; }
    .back { justify-self: start; }
    .content { min-inline-size: 0; }
    .message { display: grid; gap: var(--space-3); justify-items: start; }
    @media (width >= 40rem) { .component { padding-inline: var(--layout-page-compact); } }
    @media (width >= 64rem) { .component { padding-inline: var(--layout-page-wide); } }
  }
</style>
