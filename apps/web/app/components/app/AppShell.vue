<template>
  <div :class="$style.component" :data-authenticated="isAuthenticated">
    <header v-if="!isAuthenticated" :class="$style.guestBar">
      <NuxtLink :class="$style.wordmark" to="/" aria-label="TV home">TV</NuxtLink>
      <nav :class="$style.guestNavigation" aria-label="Main navigation">
        <NuxtLink :class="$style.guestLink" to="/" :aria-current="catalogCurrent">Catalog</NuxtLink>
        <NuxtLink :class="$style.guestLink" :to="signInLocation">Sign in</NuxtLink>
        <NuxtLink :class="$style.guestLink" :to="registerLocation">Create an account</NuxtLink>
      </nav>
      <div v-if="hasSessionError" :class="$style.sessionError">
        <AppMessage role="status">Your account is temporarily unavailable. You can still read this title.</AppMessage>
        <AppButton :disabled="isRetryingSession" variant="secondary" @click="retrySession">Retry account</AppButton>
      </div>
    </header>
    <nav v-if="isAuthenticated" :class="$style.desktopNavigation" aria-label="Main navigation">
      <NuxtLink :class="$style.navigationLink" to="/" :aria-current="catalogCurrent">
        <span :class="$style.navigationIcon"><Icon aria-hidden="true" mode="svg" name="hugeicons:film-01" /></span>
        <span :class="$style.navigationLabel">Catalog</span>
      </NuxtLink>
      <NuxtLink :class="$style.navigationLink" to="/calendar" :aria-current="calendarCurrent">
        <span :class="$style.navigationIcon"><Icon aria-hidden="true" mode="svg" name="hugeicons:calendar-03" /></span>
        <span :class="$style.navigationLabel">Calendar</span>
      </NuxtLink>
      <NuxtLink :class="$style.navigationLink" to="/watchlist" :aria-current="watchlistCurrent">
        <span :class="$style.navigationIcon"><Icon aria-hidden="true" mode="svg" name="hugeicons:bookmark-02" /></span>
        <span :class="$style.navigationLabel">Watchlist</span>
      </NuxtLink>
    </nav>
    <header v-if="isAuthenticated" :class="$style.accountBar">
      <p :class="$style.wordmark">TV</p>
      <div :class="$style.accountActions">
        <p :class="$style.accountEmail" :title="userEmail">Signed in as <strong>{{ userEmail }}</strong></p>
        <AppMessage v-if="hasSignOutError" :class="$style.accountError" role="alert" tone="danger">{{ signOutError }}</AppMessage>
        <AppButton
          ref="signOutButton"
          :class="$style.signOutButton"
          :disabled="isSigningOut"
          title="Sign out"
          variant="secondary"
          @click="signOut"
        >
          <Icon aria-hidden="true" mode="svg" name="hugeicons:logout-03" />
          <span :class="$style.signOutLabel">Sign out</span>
        </AppButton>
      </div>
    </header>
    <slot />
    <nav v-if="isAuthenticated" :class="$style.mobileNavigation" aria-label="Main navigation">
      <NuxtLink :class="$style.navigationLink" to="/" :aria-current="catalogCurrent">
        <span :class="$style.navigationIcon"><Icon aria-hidden="true" mode="svg" name="hugeicons:film-01" /></span>
        <span :class="$style.navigationLabel">Catalog</span>
      </NuxtLink>
      <NuxtLink :class="$style.navigationLink" to="/calendar" :aria-current="calendarCurrent">
        <span :class="$style.navigationIcon"><Icon aria-hidden="true" mode="svg" name="hugeicons:calendar-03" /></span>
        <span :class="$style.navigationLabel">Calendar</span>
      </NuxtLink>
      <NuxtLink :class="$style.navigationLink" to="/watchlist" :aria-current="watchlistCurrent">
        <span :class="$style.navigationIcon"><Icon aria-hidden="true" mode="svg" name="hugeicons:bookmark-02" /></span>
        <span :class="$style.navigationLabel">Watchlist</span>
      </NuxtLink>
    </nav>
  </div>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { useRequestFetch, useRoute } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { computed, nextTick, ref, useTemplateRef } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'

  type NavigationDestination = 'calendar' | 'catalog' | 'watchlist'

  interface Props {
    activeDestination?: NavigationDestination;
  }

  const { activeDestination } = defineProps<Props>()
  const emit = defineEmits<{ signedOut: [] }>()
  const route = useRoute()
  const requestFetch = useRequestFetch()
  const { restoreSession, setAnonymous, state } = useAuthSession()
  const signOutButton = useTemplateRef('signOutButton')
  const signOutError = ref('')
  const isSigningOut = ref(false)
  const isRetryingSession = ref(false)
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const hasSessionError = computed(() => state.value.status === 'error')
  const hasSignOutError = computed(() => signOutError.value !== '')
  const catalogCurrent = computed(() => activeDestination === 'catalog' ? 'page' : undefined)
  const calendarCurrent = computed(() => activeDestination === 'calendar' ? 'page' : undefined)
  const watchlistCurrent = computed(() => activeDestination === 'watchlist' ? 'page' : undefined)
  const userEmail = computed(() => state.value.status === 'authenticated' ? state.value.user.email : '')
  const redirectTo = computed(() => sanitizeRedirectTo(route.fullPath))

  const signInLocation = computed(() => {
    return {
      path: '/sign-in',
      query: { redirectTo: redirectTo.value }
    }
  })

  const registerLocation = computed(() => {
    return {
      path: '/register',
      query: { redirectTo: redirectTo.value }
    }
  })

  async function retrySession(): Promise<void> {
    isRetryingSession.value = true

    await restoreSession({ force: true })

    isRetryingSession.value = false
  }

  async function signOut(): Promise<void> {
    signOutError.value = ''
    isSigningOut.value = true

    try {
      await requestFetch('/api/auth/sign-out', { method: 'POST' })
      setAnonymous()
      emit('signedOut')
    } catch {
      signOutError.value = 'We couldn’t sign you out. Try again.'
    } finally {
      isSigningOut.value = false

      if (signOutError.value !== '') {
        await nextTick()
        signOutButton.value?.focus()
      }
    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      min-block-size: 100svh;
      background: var(--color-canvas);
    }
    .component[data-authenticated='true'] {
      padding-block-end: calc(5.5rem + env(safe-area-inset-bottom));
    }
    .accountBar, .guestBar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      padding: var(--space-4);
      padding-block-start: max(var(--space-4), env(safe-area-inset-top));
      border-block-end: 1px solid var(--color-border);
      background: var(--color-surface);
    }
    .accountBar { gap: var(--space-3); }
    .guestBar { gap: var(--space-4); }
    .wordmark {
      color: var(--color-accent);
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.08em;
      line-height: 1;
      text-decoration: none;
    }
    .accountActions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-3);
      margin-inline-start: auto;
    }
    .accountEmail {
      display: none;
      color: var(--color-text-secondary);
      font-size: 0.875rem;
    }
    .accountError { flex: 1 0 100%; }
    .signOutButton {
      inline-size: 3.5rem;
      padding-inline: var(--space-3);
      border-radius: var(--radius-round);
    }
    .signOutLabel {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .guestNavigation {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      margin-inline-start: auto;
    }
    .guestLink {
      display: inline-flex;
      align-items: center;
      min-block-size: 2.75rem;
      color: var(--color-text-primary);
      font-size: 0.875rem;
      text-decoration: none;
      text-underline-offset: 0.25em;
    }
    .guestLink[aria-current='page'] {
      font-weight: 700;
      text-decoration: underline;
      text-decoration-thickness: 0.125em;
    }
    .sessionError {
      display: flex;
      flex: 1 0 100%;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .mobileNavigation {
      position: fixed;
      inset-block-end: 0;
      inset-inline: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-1);
      padding: var(--space-2) var(--space-3);
      padding-block-end: max(var(--space-2), env(safe-area-inset-bottom));
      border-block-start: 1px solid var(--color-border);
      background: var(--color-surface);
      box-shadow: var(--shadow-card);
    }
    .desktopNavigation { display: none; }
    .navigationLink {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-1);
      min-block-size: 3.75rem;
      padding: var(--space-1);
      border-radius: var(--radius-sm);
      color: var(--color-text-primary);
      text-decoration: none;
      white-space: nowrap;
    }
    .navigationIcon {
      display: inline-grid;
      place-items: center;
      inline-size: 4rem;
      block-size: 2rem;
      border-radius: var(--radius-round);
    }
    .navigationIcon :global(svg) {
      inline-size: 1.5rem;
      block-size: 1.5rem;
    }
    .navigationLabel { font-size: 0.75rem; font-weight: 600; line-height: 1; }
    .navigationLink[aria-current='page'] {
      color: var(--color-accent);
    }
    .navigationLink[aria-current='page'] .navigationIcon {
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
    }
    .navigationLink[aria-current='page'] .navigationLabel {
      font-weight: 800;
    }
    @media (width >= 40rem) {
      .component[data-authenticated='true'] {
        padding-block-end: 0;
        padding-inline-start: var(--layout-sidebar-compact);
      }
      .accountBar {
        position: fixed;
        inset-inline-start: 0;
        inset-block: 0;
        z-index: 1;
        flex-direction: column;
        flex-wrap: nowrap;
        inline-size: var(--layout-sidebar-compact);
        padding: var(--space-4) var(--space-2);
        border-block-end: 0;
        border-inline-end: 1px solid var(--color-border);
      }
      .accountActions {
        display: grid;
        justify-items: center;
        inline-size: 100%;
        margin-block-start: auto;
        margin-inline-start: 0;
      }
      .accountError {
        position: fixed;
        inset-inline-start: calc(var(--layout-sidebar-compact) + var(--space-3));
        inset-block-end: var(--space-4);
        inline-size: min(20rem, calc(100vi - var(--layout-sidebar-compact) - 2 * var(--space-3)));
      }
      .mobileNavigation { display: none; }
      .desktopNavigation {
        position: fixed;
        inset-inline-start: 0;
        inset-block: 5rem 5rem;
        z-index: 2;
        display: grid;
        align-content: start;
        gap: var(--space-2);
        inline-size: var(--layout-sidebar-compact);
        padding: var(--space-2) var(--space-1);
      }
      .navigationLink {
        padding-inline: var(--space-1);
      }
      .guestBar { padding-inline: var(--layout-page-compact); }
    }
    @media (width >= 64rem) {
      .component[data-authenticated='true'] { padding-inline-start: var(--layout-sidebar-wide); }
      .desktopNavigation {
        inset-block: 5.5rem 11rem;
        inline-size: var(--layout-sidebar-wide);
        padding: var(--space-3) var(--space-4);
      }
      .navigationLink {
        flex-direction: row;
        justify-content: flex-start;
        gap: var(--space-2);
        min-block-size: 2.75rem;
        padding: var(--space-2);
      }
      .navigationIcon {
        inline-size: 2rem;
        block-size: 2rem;
      }
      .navigationLabel { font-size: 1rem; }
      .navigationLink[aria-current='page'] {
        background: var(--color-surface-muted);
      }
      .navigationLink[aria-current='page'] .navigationIcon {
        background: transparent;
        color: inherit;
      }
      .accountBar {
        align-items: stretch;
        inline-size: var(--layout-sidebar-wide);
        padding: var(--space-8) var(--space-4);
      }
      .accountActions {
        justify-items: stretch;
      }
      .accountEmail {
        display: block;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .accountError {
        position: static;
        inline-size: auto;
      }
      .signOutButton {
        inline-size: auto;
        border-radius: var(--radius-md);
      }
      .signOutLabel {
        position: static;
        inline-size: auto;
        block-size: auto;
        overflow: visible;
        clip-path: none;
        white-space: normal;
      }
      .guestBar { padding-inline: var(--layout-page-wide); }
    }
    @media (forced-colors: active) {
      .navigationLink[aria-current='page'] {
        text-decoration: underline;
        text-decoration-thickness: 0.125em;
        text-underline-offset: 0.25em;
      }
    }
  }
</style>
