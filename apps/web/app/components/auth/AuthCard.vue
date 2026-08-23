<template>
  <main>
    <section>
      <header>
        <h1>
          {{ title }}
        </h1>
      </header>

      <slot name="notice" />
      <slot />

      <footer>
        <slot name="footer" />
      </footer>
    </section>
  </main>
</template>

<script lang="ts" setup>
  interface Props {
    title: string;
  }

  defineProps<Props>()
</script>
