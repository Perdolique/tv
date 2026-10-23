<template><CatalogManagerShell title="Incoming requests"><RequestList manager /></CatalogManagerShell></template>
<script setup lang="ts">
  import { useHead, useResponseHeader } from '#app'
  import { definePageMeta } from '#app/composables/pages'
  import CatalogManagerShell from '~/components/catalog/CatalogManagerShell.vue'
  import RequestList from '~/components/requests/RequestList.vue'

  definePageMeta({ middleware: ['authenticated', 'catalog-import'] })
  useHead({ title: 'Incoming requests · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'
</script>
