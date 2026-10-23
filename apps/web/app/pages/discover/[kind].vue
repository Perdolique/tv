<template><CatalogBrowsePage :key="kind" :kind="kind" /></template>
<script setup lang="ts">
  import { createError, useRoute, useResponseHeader } from '#app'
  import { definePageMeta } from '#app/composables/pages'
  import * as v from 'valibot'
  import { discoveryKindSchema } from '@tv/shared/catalog-discovery'
  import CatalogBrowsePage from '~/components/catalog/CatalogBrowsePage.vue'

  definePageMeta({
    middleware: 'public-session',
    key: route => route.path
  })

  useResponseHeader('Cache-Control').value = 'private, no-store'

  const route = useRoute()
  const parsed = v.safeParse(discoveryKindSchema, route.params.kind)

  if (!parsed.success) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Collection not found'
    })
  }

  const kind = parsed.output
</script>
