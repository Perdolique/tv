<template>
  <div :class="$style.component" :aria-busy="isLoading">
    <img v-if="hasImage" ref="image" :class="$style.image" :data-loaded="hasLoaded" :src="imageSource" :alt="alternative" width="480" height="720" decoding="async" @load="imageLoaded" @error="imageFailed" />
    <p v-if="showPlaceholder" :class="$style.placeholder" role="status">{{ placeholder }}</p>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref, useTemplateRef } from 'vue'

  interface Props {
    posterUrl: string | null;
    title: string;
  }

  const { posterUrl, title } = defineProps<Props>()
  const hasLoaded = ref(false)
  const hasFailed = ref(false)
  const image = useTemplateRef('image')
  const hasImage = computed(() => posterUrl !== null && !hasFailed.value)
  const imageSource = computed(() => posterUrl ?? undefined)
  const isLoading = computed(() => hasImage.value && !hasLoaded.value)
  const showPlaceholder = computed(() => !hasLoaded.value || hasFailed.value)
  const placeholder = computed(() => isLoading.value ? 'Loading poster…' : 'No poster available')
  const alternative = computed(() => `${title} poster`)

  function imageLoaded(): void {
    hasLoaded.value = true
  }

  function imageFailed(): void {
    hasFailed.value = true
  }

  onMounted(() => {
    // A cached SSR image can finish before Vue attaches its load/error listeners.
    if (image.value?.complete) {
      if (image.value.naturalWidth > 0) {
        imageLoaded()
      } else {
        imageFailed()
      }
    }
  })

</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      position: relative;
      inline-size: 100%;
      aspect-ratio: 2 / 3;
      overflow: hidden;
      border-radius: var(--radius-lg);
      background: var(--color-surface-muted);
    }
    .image {
      inline-size: 100%;
      block-size: 100%;
      object-fit: cover;
      opacity: 0;
      &[data-loaded='true'] { opacity: 1; }
    }
    .placeholder {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: var(--space-4);
      color: var(--color-text-secondary);
      font-size: 0.875rem;
      text-align: center;
    }
  }
</style>
