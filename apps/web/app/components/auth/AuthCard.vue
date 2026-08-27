<template>
  <main :class="$style.component">
    <picture :class="$style.artwork" aria-hidden="true">
      <source
        media="(width >= 64rem)"
        :sizes="landscapeSizes"
        :srcset="landscapeAvifSourceSet"
        type="image/avif"
      >
      <source
        media="(width >= 64rem)"
        :sizes="landscapeSizes"
        :srcset="landscapeWebpSourceSet"
        type="image/webp"
      >
      <source
        :sizes="portraitSizes"
        :srcset="portraitAvifSourceSet"
        type="image/avif"
      >
      <source
        :sizes="portraitSizes"
        :srcset="portraitWebpSourceSet"
        type="image/webp"
      >
      <img
        :class="$style.artworkImage"
        alt=""
        decoding="async"
        fetchpriority="high"
        height="2400"
        loading="eager"
        :sizes="portraitSizes"
        :src="portrait1600Webp"
        :srcset="portraitWebpSourceSet"
        width="1600"
      >
    </picture>

    <div :class="$style.overlay" aria-hidden="true" />

    <header :class="$style.navigation">
      <NuxtLink
        :class="$style.wordmark"
        aria-label="TV home"
        to="/"
      >
        TV
      </NuxtLink>

      <NuxtLink :class="$style.back" to="/">
        <svg
          :class="$style.backIcon"
          aria-hidden="true"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path d="m15 18-6-6 6-6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
        </svg>
        Back
      </NuxtLink>
    </header>

    <div :class="$style.layout">
      <div :class="$style.contentColumn">
        <section :class="$style.marketing" aria-label="TV highlights">
          <p :class="$style.tagline">
            Every story, right on time.
          </p>

          <ul :class="$style.featureList">
            <li :class="$style.feature">
              <svg :class="$style.featureIcon" aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <rect height="16" rx="2" stroke="currentColor" stroke-width="1.75" width="18" x="3" y="5" />
                <path d="M8 3v4m8-4v4M3 10h18" stroke="currentColor" stroke-linecap="round" stroke-width="1.75" />
              </svg>
              Track releases
            </li>
            <li :class="$style.feature">
              <svg :class="$style.featureIcon" aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <path d="m12 3 2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6-4.36-4.25 6.03-.88L12 3Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.75" />
              </svg>
              Rate what you watch
            </li>
            <li :class="$style.feature">
              <svg :class="$style.featureIcon" aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-4A4.5 4.5 0 0 0 3 18.5V20m13-8a4 4 0 1 0 0-8m1.5 10.5A4.5 4.5 0 0 1 22 19v1M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" stroke-linecap="round" stroke-width="1.75" />
              </svg>
              Follow friends
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
    </div>
  </main>
</template>

<script lang="ts" setup>
  import { useSlots } from 'vue'

  interface Props {
    description: string;
    title: string;
  }

  const {
    description,
    title
  } = defineProps<Props>()

  const slots = useSlots()
  const hasNotice = slots.notice !== undefined
  const landscapeSizes = '100vw'
  const portraitSizes = '100vw'
  const landscape800Avif = '/images/auth/auth-collage-landscape-800.d70d0409.avif'
  const landscape1600Avif = '/images/auth/auth-collage-landscape-1600.e2ca5aae.avif'
  const landscape800Webp = '/images/auth/auth-collage-landscape-800.0d01280a.webp'
  const landscape1600Webp = '/images/auth/auth-collage-landscape-1600.f6bc32fe.webp'
  const portrait800Avif = '/images/auth/auth-collage-portrait-800.301795e0.avif'
  const portrait1200Avif = '/images/auth/auth-collage-portrait-1200.2fe9c722.avif'
  const portrait1600Avif = '/images/auth/auth-collage-portrait-1600.d297754f.avif'
  const portrait800Webp = '/images/auth/auth-collage-portrait-800.417cbe40.webp'
  const portrait1200Webp = '/images/auth/auth-collage-portrait-1200.196de5c3.webp'
  const portrait1600Webp = '/images/auth/auth-collage-portrait-1600.c7ce6728.webp'
  const landscapeAvifSourceSet = `${landscape800Avif} 800w, ${landscape1600Avif} 1600w`
  const landscapeWebpSourceSet = `${landscape800Webp} 800w, ${landscape1600Webp} 1600w`
  const portraitAvifSourceSet = `${portrait800Avif} 800w, ${portrait1200Avif} 1200w, ${portrait1600Avif} 1600w`
  const portraitWebpSourceSet = `${portrait800Webp} 800w, ${portrait1200Webp} 1200w, ${portrait1600Webp} 1600w`
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      position: relative;
      isolation: isolate;
      min-block-size: 100svh;
      overflow: hidden;
      background: var(--color-canvas);
    }

    .artwork,
    .overlay {
      position: absolute;
      inset: 0;
      z-index: -2;
      block-size: 100%;
      inline-size: 100%;
    }

    .artworkImage {
      display: block;
      block-size: 100%;
      inline-size: 100%;
      object-fit: cover;
      object-position: center top;
    }

    .artwork {
      background: var(--color-artwork-fallback);
    }

    .overlay {
      z-index: -1;
      background: linear-gradient(to bottom, transparent 12%, var(--color-auth-overlay-mobile) 44%, var(--color-canvas) 88%);
    }

    .navigation {
      display: flex;
      align-items: center;
      justify-content: space-between;
      inline-size: min(100%, var(--layout-content-max));
      margin-inline: auto;
      padding: var(--space-5) var(--layout-page-mobile);
    }

    .wordmark,
    .back {
      color: var(--color-on-art);
      text-decoration: none;
      text-shadow: 0 0.125rem 0.5rem var(--color-art-shadow);
    }

    .wordmark {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.08em;
      line-height: 1;
    }

    .back {
      display: inline-flex;
      gap: var(--space-1);
      align-items: center;
      font-weight: 500;
    }

    .backIcon {
      block-size: 1.5rem;
      inline-size: 1.5rem;
    }

    .layout {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      min-block-size: calc(100svh - 4.5rem);
      padding: clamp(12rem, 34svh, 20rem) var(--layout-page-mobile) var(--space-8);
    }

    .contentColumn {
      display: grid;
      gap: var(--space-6);
      inline-size: min(100%, 36rem);
    }

    .marketing {
      display: none;
      color: var(--color-on-art);
      text-shadow: 0 0.125rem 0.75rem var(--color-art-shadow);
    }

    .tagline {
      font-size: clamp(2rem, 4.5vw, 3rem);
      font-weight: 600;
      letter-spacing: -0.035em;
      line-height: 1.08;
    }

    .featureList {
      display: none;
      gap: var(--space-3);
      padding: 0;
      list-style: none;
    }

    .feature {
      display: flex;
      gap: var(--space-3);
      align-items: center;
      font-weight: 500;
    }

    .featureIcon {
      box-sizing: content-box;
      block-size: 1.35rem;
      inline-size: 1.35rem;
      padding: var(--space-2);
      border: 1px solid var(--color-art-feature-border);
      border-radius: var(--radius-round);
      background: var(--color-art-feature-surface);
    }

    .card {
      display: grid;
      gap: var(--space-6);
      padding: var(--space-6);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      background: var(--color-auth-panel);
      box-shadow: var(--shadow-float);
      color: var(--color-text-primary);
      backdrop-filter: blur(1rem);
    }

    .cardHeader {
      display: grid;
      gap: var(--space-2);
    }

    .title {
      font-size: clamp(1.75rem, 5vw, 2.25rem);
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1.17;
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
      .navigation {
        padding: var(--space-6) var(--layout-page-compact);
      }

      .layout {
        padding-block-start: clamp(14rem, 43svh, 24rem);
        padding-inline: var(--layout-page-compact);
      }

      .marketing {
        display: grid;
        justify-items: center;
        text-align: center;
      }

      .card {
        padding: var(--space-8);
      }
    }

    @media (width >= 64rem) {
      .artworkImage {
        object-position: center;
      }

      .overlay {
        background: linear-gradient(to right, var(--color-auth-overlay-desktop) 0%, var(--color-auth-overlay-desktop) 31%, transparent 68%);
      }

      .navigation {
        padding: var(--space-8) var(--layout-page-wide);
      }

      .layout {
        align-items: center;
        justify-content: flex-start;
        inline-size: min(100%, var(--layout-content-max));
        min-block-size: calc(100svh - 6rem);
        margin-inline: auto;
        padding: var(--space-8) var(--layout-page-wide) var(--space-12);
      }

      .contentColumn {
        inline-size: min(34vw, 30rem);
      }

      .marketing {
        justify-items: start;
        text-align: start;
      }

      .featureList {
        display: grid;
        margin-block-start: var(--space-6);
      }
    }
  }
</style>
