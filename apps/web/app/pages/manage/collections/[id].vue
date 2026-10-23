<template><CatalogManagerShell :title="title"><CatalogCollectionEditor :key="routeKey" :collection-id="collectionId" /></CatalogManagerShell></template>
<script setup lang="ts">
  import { createError, useRoute, useHead, useResponseHeader } from '#app'
  import { definePageMeta } from '#app/composables/pages'
  import * as v from 'valibot'
  import { collectionIdSchema } from '@tv/shared/catalog-discovery'
  import CatalogManagerShell from '~/components/catalog/CatalogManagerShell.vue'
  import CatalogCollectionEditor from '~/components/catalog/CatalogCollectionEditor.vue'

  definePageMeta({
    middleware: ['authenticated', 'catalog-import'],
    key: route => route.path
  })

  useResponseHeader('Cache-Control').value = 'private, no-store'

  const route = useRoute()
  const routeKey = String(route.params.id)
  const isNew = routeKey === 'new'

  if (!isNew && !v.is(collectionIdSchema, routeKey)) {
    throw createError({
    statusCode: 404,
    statusMessage: 'Collection not found'
  })
  }

  const collectionId = isNew ? undefined : routeKey
  const title = isNew ? 'Create collection' : 'Edit collection'

  useHead({ title: `${title} · TV` })
</script>
