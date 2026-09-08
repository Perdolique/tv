<template>
  <div :class="$style.component" :data-authenticated="isAuthenticated">
    <header v-if="isAuthenticated" :class="$style.accountBar">
      <p :class="$style.wordmark">TV</p>
      <p :class="$style.accountEmail">Signed in as <strong>{{ userEmail }}</strong></p>
      <AppMessage v-if="hasSignOutError" role="alert" tone="danger">{{ signOutError }}</AppMessage>
      <AppButton ref="signOutButton" :disabled="isSigningOut" variant="secondary" @click="signOut">Sign out</AppButton>
    </header>
    <header v-else :class="$style.guestBar">
      <NuxtLink :class="$style.wordmark" to="/" aria-label="TV home">TV</NuxtLink>
      <nav :class="$style.guestNavigation" aria-label="Main navigation">
        <NuxtLink :class="$style.guestLink" to="/">Catalog</NuxtLink>
        <NuxtLink :class="$style.guestLink" :to="signInLocation">Sign in</NuxtLink>
        <NuxtLink :class="$style.guestLink" :to="registerLocation">Create an account</NuxtLink>
      </nav>
      <div v-if="hasSessionError" :class="$style.sessionError">
        <AppMessage role="status">Your account is temporarily unavailable. You can still read this title.</AppMessage>
        <AppButton :disabled="isRetryingSession" variant="secondary" @click="retrySession">Retry account</AppButton>
      </div>
    </header>
    <nav v-if="isAuthenticated" :class="$style.desktopCatalogNavigation" aria-label="Main navigation">
      <NuxtLink :class="$style.catalogLink" to="/" :aria-current="catalogCurrent">
        <Icon aria-hidden="true" mode="svg" name="hugeicons:film-01" />
        <span>Catalog</span>
      </NuxtLink>
    </nav>
    <slot />
    <nav v-if="isAuthenticated" :class="$style.mobileCatalogNavigation" aria-label="Main navigation">
      <NuxtLink :class="$style.catalogLink" to="/" :aria-current="catalogCurrent">
        <Icon aria-hidden="true" mode="svg" name="hugeicons:film-01" />
        <span>Catalog</span>
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

  interface Props {
    activeCatalog?: boolean;
  }

  const { activeCatalog } = defineProps<Props>()
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
  const catalogCurrent = computed(() => activeCatalog ? 'page' : undefined)
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
      padding-block-end: calc(5rem + env(safe-area-inset-bottom));
    }
    .accountBar, .guestBar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-4);
      padding-block-start: max(var(--space-4), env(safe-area-inset-top));
      border-block-end: 1px solid var(--color-border);
      background: var(--color-surface);
    }
    .accountBar { gap: var(--space-3); }
    .wordmark {
      color: var(--color-accent);
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.08em;
      line-height: 1;
      text-decoration: none;
    }
    .accountEmail {
      flex: 1 1 10rem;
      color: var(--color-text-secondary);
      font-size: 0.875rem;
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
      text-underline-offset: 0.25em;
    }
    .sessionError {
      display: flex;
      flex: 1 0 100%;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .mobileCatalogNavigation {
      position: fixed;
      inset-block-end: 0;
      inset-inline: 0;
      z-index: 2;
      padding: var(--space-2) var(--space-4);
      padding-block-end: max(var(--space-2), env(safe-area-inset-bottom));
      border-block-start: 1px solid var(--color-border);
      background: var(--color-surface);
    }
    .desktopCatalogNavigation { display: none; }
    .catalogLink {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-block-size: 2.75rem;
      padding: var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--color-surface-muted);
      color: var(--color-text-primary);
      font-weight: 600;
      text-decoration: none;
    }
    @media (width >= 40rem) {
      .component[data-authenticated='true'] {
        padding-block-end: 0;
        padding-inline-start: var(--layout-sidebar-compact);
      }
      .mobileCatalogNavigation { display: none; }
      .desktopCatalogNavigation {
        position: fixed;
        inset-inline-start: 0;
        inset-block: 0;
        z-index: 2;
        display: block;
        inline-size: var(--layout-sidebar-compact);
        padding: var(--space-4) var(--space-1);
        border-inline-end: 1px solid var(--color-border);
      }
      .catalogLink {
        flex-direction: column;
        font-size: 0.875rem;
      }
      .guestBar { padding-inline: var(--layout-page-compact); }
    }
    @media (width >= 64rem) {
      .component[data-authenticated='true'] { padding-inline-start: var(--layout-sidebar-wide); }
      .desktopCatalogNavigation {
        inset-block: auto 0;
        inline-size: var(--layout-sidebar-wide);
        padding: var(--space-8) var(--space-4);
        border-inline-end: 0;
      }
      .catalogLink {
        flex-direction: row;
        justify-content: flex-start;
        font-size: 1rem;
      }
      .accountBar {
        position: fixed;
        inset-inline-start: 0;
        inset-block: 0;
        flex-direction: column;
        align-items: stretch;
        inline-size: var(--layout-sidebar-wide);
        padding: var(--space-8) var(--space-4);
        border-block-end: 0;
        border-inline-end: 1px solid var(--color-border);
      }
      .accountEmail { flex: 0 1 auto; }
      .guestBar { padding-inline: var(--layout-page-wide); }
    }
  }
</style>
