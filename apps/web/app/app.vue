<template>
  <div :class="$style.component">
    <div :class="$style.page">
      <NuxtRouteAnnouncer />
      <NuxtPage />
    </div>
    <div :class="$style.gutter" aria-hidden="true" inert />
  </div>
</template>

<script lang="ts" setup>
  import { NuxtPage, NuxtRouteAnnouncer } from '#components'
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      inline-size: 100vi;
    }
    .page {
      anchor-name: --app-page;
    }
    /* Reserve the native scrollbar width without clipping full-width page surfaces. */
    .gutter {
      overflow-y: scroll;
      /* Keep the column width when scrollbar styles load later. */
      scrollbar-gutter: stable;
      opacity: 0;
    }
  }
</style>
