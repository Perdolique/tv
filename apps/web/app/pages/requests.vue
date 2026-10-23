<template><AppShell @signed-out="navigateTo('/')"><main :class="$style.component"><header :class="$style.header"><h1>Your requests</h1><NuxtLink to="/request-title">Request title</NuxtLink></header><RequestList /></main></AppShell></template>
<script setup lang="ts">
  import { useHead, useResponseHeader, navigateTo } from '#app'
  import { definePageMeta } from '#app/composables/pages'
  import AppShell from '~/components/app/AppShell.vue'
  import RequestList from '~/components/requests/RequestList.vue'

  definePageMeta({ middleware: ['authenticated'] })
  useHead({ title: 'Your requests · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'
</script>
<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-6); padding: var(--space-8) var(--layout-page-mobile); }
    .header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-4); }
    .header h1 { font-size: 2rem; }
    @media (width >= 40rem) { .component { padding-inline: var(--layout-page-compact); } }
    @media (width >= 64rem) { .component { padding-inline: var(--layout-page-wide); } }
  }
</style>
