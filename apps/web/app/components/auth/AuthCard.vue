<script setup lang="ts">
interface Props {
  description: string;
  title: string;
}

defineProps<Props>()
</script>

<template>
  <main :class="$style.component">
    <section :class="$style.card">
      <p :class="$style.brand">
        TV
      </p>

      <header :class="$style.header">
        <h1 :class="$style.title">
          {{ title }}
        </h1>

        <p :class="$style.description">
          {{ description }}
        </p>
      </header>

      <slot name="notice" />
      <slot />

      <footer :class="$style.footer">
        <slot name="footer" />
      </footer>
    </section>
  </main>
</template>

<style module>
.component {
  display: grid;
  min-block-size: 100vh;
  place-items: center;
  padding: 2rem 1rem;
  background:
    radial-gradient(circle at top, rgb(37 99 235 / 18%), transparent 34rem),
    #090d16;
  color: #f8fafc;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.card {
  inline-size: min(100%, 28rem);
  padding: 2rem;
  border: 1px solid #263244;
  border-radius: 1.25rem;
  background: #111827;
  box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 35%);
}

.brand {
  color: #60a5fa;
  font-size: 0.875rem;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.header {
  margin-block-start: 0.75rem;
}

.title {
  font-size: clamp(1.75rem, 5vw, 2.25rem);
  line-height: 1.1;
}

.description {
  margin-block-start: 0.75rem;
  color: #aeb9c9;
  line-height: 1.55;
}

.footer {
  margin-block-start: 1.5rem;
  color: #aeb9c9;
  font-size: 0.9375rem;
  text-align: center;
}

@media (max-width: 30rem) {
  .card {
    padding: 1.5rem;
  }
}
</style>
