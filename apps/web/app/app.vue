<template>
  <main :class="$style.component">
    <h1 :class="$style.heading">
      TV
    </h1>

    <p :class="$style.description">
      TV repository foundation is running.
    </p>
  </main>
</template>

<style module>
.component {
  display: grid;
  min-block-size: 100vh;
  place-content: center;
  padding: 2rem;
  background: #111827;
  color: #f9fafb;
  font-family: system-ui, sans-serif;
  text-align: center;
}

.heading {
  font-size: 3rem;
}

.description {
  margin: 1rem 0 0;
  color: #d1d5db;
}
</style>
