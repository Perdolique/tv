<template><CatalogManagerShell title="Collections"><CatalogCollectionManagerList :key="page" :page="page" /></CatalogManagerShell></template>
<script setup lang="ts">
  import { useRoute, useHead, useResponseHeader } from '#app'
  import { definePageMeta } from '#app/composables/pages'
  import { computed } from 'vue'
  import CatalogManagerShell from '~/components/catalog/CatalogManagerShell.vue'
  import CatalogCollectionManagerList from '~/components/catalog/CatalogCollectionManagerList.vue'

  definePageMeta({ middleware: ['authenticated', 'catalog-import'] })

  useResponseHeader('Cache-Control').value = 'private, no-store'

  useHead({ title: 'Manage collections · TV' })

  const route = useRoute()

  const page = computed(() => {
    const value = Number(route.query.page ?? 1)

    return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000 ? value : 1
  })
</script>
