<template>
  <main :class="$style.component">
    <header :class="$style.navigation">
      <NuxtLink
        :class="$style.wordmark"
        aria-label="TV home"
        to="/"
      >
        TV
      </NuxtLink>
    </header>

    <div :class="$style.layout">
      <section :class="$style.marketing" aria-label="TV highlights">
        <p :class="$style.tagline">
          {{ marketingTitle }}
        </p>

        <ul :class="$style.featureList">
          <li
            v-for="marketingItem in marketingItems"
            :key="marketingItem"
            :class="$style.feature"
          >
            {{ marketingItem }}
          </li>
        </ul>
      </section>

      <section :class="$style.card">
        <header :class="$style.cardHeader">
          <h1 :class="$style.title">
            {{ title }}
          </h1>
          <p :class="$style.description">
            {{ description }}
          </p>
        </header>

        <div v-if="hasNotice" :class="$style.notice">
          <slot name="notice" />
        </div>

        <div :class="$style.body">
          <slot />
        </div>

        <footer :class="$style.footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </main>
</template>

<script lang="ts" setup>
  import { useSlots } from 'vue'

  type MarketingItems = readonly [string, string, string]

  interface Props {
    description: string;
    marketingItems: MarketingItems;
    marketingTitle: string;
    title: string;
  }

  const {
    description,
    marketingItems,
    marketingTitle,
    title
  } = defineProps<Props>()

  const slots = useSlots()
  const hasNotice = slots.notice !== undefined
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      position: relative;
      min-block-size: 100svh;
      background: var(--color-canvas);
    }

    .navigation {
      display: flex;
      align-items: center;
      justify-content: space-between;
      inline-size: min(100%, var(--layout-content-max));
      margin-inline: auto;
      padding: var(--space-5) var(--layout-page-mobile);
    }

    .wordmark {
      color: var(--color-text-primary);
      text-decoration: none;
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.08em;
      line-height: 1;
    }

    .layout {
      display: grid;
      align-items: center;
      justify-items: center;
      min-block-size: calc(100svh - 4.5rem);
      padding: var(--space-8) var(--layout-page-mobile) var(--space-12);
    }

    .marketing {
      display: none;
    }

    .tagline {
      font-size: 3rem;
      font-weight: 600;
      letter-spacing: -0.035em;
      line-height: 1.08;
    }

    .featureList {
      display: none;
      gap: var(--space-5);
      padding: 0;
      list-style: none;
    }

    .feature {
      color: var(--color-text-primary);
      font-size: 1.125rem;
    }

    .card {
      display: grid;
      gap: var(--space-6);
      inline-size: min(100%, 30rem);
      color: var(--color-text-primary);
    }

    .cardHeader {
      display: grid;
      gap: var(--space-2);
    }

    .title {
      font-size: clamp(2rem, 8vw, 2.25rem);
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1.12;
    }

    .description,
    .footer {
      color: var(--color-text-secondary);
    }

    .notice,
    .body {
      min-inline-size: 0;
    }

    .footer {
      text-align: center;
    }

    @media (width >= 40rem) {
      .component {
        background: var(--color-surface-muted);
      }

      .navigation {
        position: absolute;
        inset-block-start: 0;
        inset-inline: 0;
        z-index: 1;
        padding: var(--space-6) var(--layout-page-compact);
      }

      .layout {
        align-content: center;
        gap: var(--space-8);
        min-block-size: 100svh;
        padding: 6rem var(--layout-page-compact) var(--space-12);
      }

      .marketing {
        display: grid;
        justify-items: center;
        text-align: center;
      }

      .card {
        padding: var(--space-8);
        border-radius: var(--radius-xl);
        background: var(--color-surface);
        box-shadow: var(--shadow-float);
      }
    }

    @media (width >= 64rem) {
      .component {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        background: var(--color-canvas);
      }

      .navigation {
        position: absolute;
        inset-block-start: 0;
        inset-inline-start: 0;
        inset-inline-end: auto;
        z-index: 1;
        inline-size: 50%;
        margin-inline: 0;
        padding: var(--space-8) var(--layout-page-wide);
      }

      .layout {
        align-content: stretch;
        align-items: stretch;
        grid-column: 1 / -1;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0;
        min-block-size: 100svh;
        padding: 0;
      }

      .marketing {
        align-content: center;
        align-self: stretch;
        grid-column: 2;
        grid-row: 1;
        justify-self: stretch;
        justify-items: start;
        padding: 10rem clamp(var(--space-8), 5vw, var(--space-16)) var(--space-12);
        background: var(--color-surface-muted);
        text-align: start;
      }

      .featureList {
        display: grid;
        margin-block-start: var(--space-8);
      }

      .tagline {
        max-inline-size: 11ch;
      }

      .card {
        align-self: center;
        grid-column: 1;
        grid-row: 1;
        justify-self: center;
        inline-size: min(calc(100% - var(--layout-page-wide) - var(--layout-page-wide)), 30rem);
        padding: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }
    }
  }
</style>
