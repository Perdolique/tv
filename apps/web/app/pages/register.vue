<template>
  <AuthCard
    :class="$style.component"
    description="Build your watchlist in a minute."
    :marketing-items="registerMarketingItems"
    marketing-title="Your next obsession starts here."
    :title="title"
  >
    <template v-if="hasSessionWarning" #notice>
      <p
        :class="$style.notice"
        role="status"
      >
        We couldn’t verify your current session. You can still register.
      </p>
    </template>

    <form
      v-if="showsEmailForm"
      :class="$style.form"
      novalidate
      @submit.prevent="requestVerification"
    >
      <EmailField
        ref="emailField"
        v-model="email"
        :error="emailError"
      />

      <p
        v-if="hasFormError"
        ref="formError"
        :class="$style.formError"
        role="alert"
        tabindex="-1"
      >
        {{ formError }}
      </p>

      <TurnstileWidget
        ref="turnstileWidget"
        v-model="turnstileToken"
        :action="TURNSTILE_ACTIONS.register"
      />

      <button
        :class="$style.primaryButton"
        :disabled="isEmailSubmitDisabled"
        type="submit"
      >
        Email me a verification link
      </button>
    </form>

    <div v-else-if="showsCheckEmail" :class="$style.state">
      <p :class="$style.stateMessage" role="status">
        Check your email for the next step. If the address can be used, a message is on its way.
      </p>

      <button :class="$style.secondaryButton" type="button" @click="startAgain">
        Use a different email
      </button>
    </div>

    <form
      v-else-if="showsPasswordForm"
      :class="$style.form"
      novalidate
      @submit.prevent="completeRegistration"
    >
      <PasswordField
        ref="passwordField"
        v-model="password"
        autocomplete="new-password"
        :error="passwordError"
        hint="Use between 15 and 128 characters."
        label="Password"
        :toggle-label="passwordToggleLabel"
        :visible="isPasswordVisible"
        @toggle="togglePasswordVisibility"
      />

      <p
        v-if="hasFormError"
        ref="formError"
        :class="$style.formError"
        role="alert"
        tabindex="-1"
      >
        {{ formError }}
      </p>

      <button
        :class="$style.primaryButton"
        :disabled="isSubmitting"
        type="submit"
      >
        Create account
      </button>
    </form>

    <div v-else :class="$style.state">
      <p
        ref="verificationError"
        :class="$style.formError"
        role="alert"
        tabindex="-1"
      >
        This verification link is invalid or has expired.
      </p>

      <NuxtLink
        :class="$style.stateLink"
        :to="registerLocation"
        @click="startAgain"
      >
        Start registration again
      </NuxtLink>
    </div>

    <template #footer>
      Already have an account?
      <NuxtLink :class="$style.footerLink" :to="signInLocation">
        Sign in
      </NuxtLink>
    </template>
  </AuthCard>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useRequestFetch, useRoute, useState } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { TURNSTILE_ACTIONS, TURNSTILE_RESPONSE_FIELD } from '@tv/shared/turnstile'
  import * as v from 'valibot'
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
  import AuthCard from '~/components/auth/AuthCard.vue'
  import EmailField from '~/components/auth/EmailField.vue'
  import PasswordField from '~/components/auth/PasswordField.vue'
  import TurnstileWidget from '~/components/auth/TurnstileWidget.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import type { AuthFieldErrors, RegistrationNotice } from '~/types/auth.ts'
  import { getFetchErrorData, parseAuthError } from '~/utils/auth-error.ts'
  import { registrationCompletionResponseSchema, registrationResponseSchema } from '~/utils/auth-response.ts'
  import { validateEmail, validatePassword } from '~/utils/auth-validation.ts'
  import { parseRegistrationFragment } from '~/utils/registration-fragment.ts'

  type RegistrationMode = 'check-email' | 'email' | 'invalid' | 'password'

  definePageMeta({ middleware: 'guest' })
  useHead({ title: 'Create account · TV' })

  const registerMarketingItems = [
    'Personal calendar',
    'Ratings that matter',
    'Watch with friends'
  ] as const

  const route = useRoute()
  const requestFetch = useRequestFetch()
  const { state } = useAuthSession()

  const registrationNotice = useState<RegistrationNotice | null>(
    'registration-notice',
    () => null
  )

  const email = ref('')
  const password = ref('')
  const token = ref('')
  const mode = ref<RegistrationMode>('email')
  const fields = ref<AuthFieldErrors>({})
  const formError = ref('')
  const isSubmitting = ref(false)
  const isPasswordVisible = ref(false)
  const turnstileToken = ref('')
  const emailField = useTemplateRef('emailField')
  const passwordField = useTemplateRef('passwordField')
  const turnstileWidget = useTemplateRef('turnstileWidget')
  const formErrorElement = useTemplateRef('formError')
  const verificationError = useTemplateRef('verificationError')
  const redirectTo = computed(() => sanitizeRedirectTo(route.query.redirectTo))

  const registerLocation = computed(() => {
    return {
      path: '/register',
      query: { redirectTo: redirectTo.value }
    }
  })

  const signInLocation = computed(() => {
    return {
      path: '/sign-in',
      query: { redirectTo: redirectTo.value }
    }
  })

  const title = computed(() => mode.value === 'password'
    ? 'Choose your password'
    : 'Create your account')

  const showsEmailForm = computed(() => mode.value === 'email')
  const showsCheckEmail = computed(() => mode.value === 'check-email')
  const showsPasswordForm = computed(() => mode.value === 'password')
  const emailError = computed(() => fields.value.email)
  const passwordError = computed(() => fields.value.password)
  const hasFormError = computed(() => formError.value !== '')
  const hasSessionWarning = computed(() => state.value.status === 'error')

  const isEmailSubmitDisabled = computed(() => (
    isSubmitting.value || turnstileToken.value === ''
  ))

  const passwordToggleLabel = computed(() => isPasswordVisible.value
    ? 'Hide password'
    : 'Show password')

  async function focusVerificationError(): Promise<void> {
    await nextTick()
    verificationError.value?.focus()
  }

  function resetErrors(): void {
    fields.value = {}
    formError.value = ''
  }

  function clearRegistrationFragment(): void {
    globalThis.history.replaceState(
      globalThis.history.state,
      '',
      `${globalThis.location.pathname}${globalThis.location.search}`
    )
  }

  async function applyRegistrationFragment(hash: string): Promise<void> {
    const fragment = parseRegistrationFragment(hash)

    if (fragment.status === 'absent') {
      return
    }

    clearRegistrationFragment()
    resetErrors()
    password.value = ''
    token.value = ''
    isPasswordVisible.value = false

    if (fragment.status === 'invalid') {
      mode.value = 'invalid'
      await focusVerificationError()

      return
    }

    token.value = fragment.token
    mode.value = 'password'
    await nextTick()
    passwordField.value?.focus()
  }

  async function handleRegistrationHashChange(): Promise<void> {
    await applyRegistrationFragment(globalThis.location.hash)
  }

  watch(() => route.hash, applyRegistrationFragment)

  onMounted(async () => {
    globalThis.addEventListener('hashchange', handleRegistrationHashChange)
    await handleRegistrationHashChange()
  })

  onBeforeUnmount(() => {
    globalThis.removeEventListener('hashchange', handleRegistrationHashChange)
  })

  async function focusFirstError(): Promise<void> {
    await nextTick()

    if (emailError.value !== undefined) {
      emailField.value?.focus()

      return
    }

    if (passwordError.value !== undefined) {
      passwordField.value?.focus()

      return
    }

    formErrorElement.value?.focus()
  }

  async function startAgain(): Promise<void> {
    resetErrors()
    password.value = ''
    token.value = ''
    isPasswordVisible.value = false
    mode.value = 'email'
    await nextTick()
    emailField.value?.focus()
  }

  function togglePasswordVisibility(): void {
    isPasswordVisible.value = !isPasswordVisible.value
  }

  async function requestVerification(): Promise<void> {
    resetErrors()

    const validation = validateEmail(email.value)

    if (validation.payload === null) {
      fields.value = validation.fields
      await focusFirstError()

      return
    }

    isSubmitting.value = true

    try {
      const response = await requestFetch('/api/auth/register', {
        body: {
          [TURNSTILE_RESPONSE_FIELD]: turnstileToken.value,
          email: validation.payload.email,
          redirectTo: redirectTo.value
        },

        method: 'POST'
      })

      v.parse(registrationResponseSchema, response)
      mode.value = 'check-email'
    } catch (error) {
      const parsedError = parseAuthError(getFetchErrorData(error))

      fields.value = parsedError.fields
      formError.value = parsedError.message
      await focusFirstError()
    } finally {
      turnstileWidget.value?.reset()
      isSubmitting.value = false
    }
  }

  async function completeRegistration(): Promise<void> {
    resetErrors()

    const validation = validatePassword(password.value)

    if (validation.payload === null) {
      fields.value = validation.fields
      await focusFirstError()

      return
    }

    isSubmitting.value = true

    try {
      const response = await requestFetch('/api/auth/register/complete', {
        body: {
          password: validation.payload.password,
          token: token.value
        },

        method: 'POST'
      })

      const account = v.parse(registrationCompletionResponseSchema, response)
      const safeRedirectTo = sanitizeRedirectTo(account.redirectTo)

      password.value = ''
      registrationNotice.value = {
        created: true,
        email: account.email
      }

      await navigateTo({
        path: '/sign-in',
        query: { redirectTo: safeRedirectTo }
      }, { replace: true })

      registrationNotice.value = null
    } catch (error) {
      const parsedError = parseAuthError(getFetchErrorData(error))

      if (parsedError.code === 'INVALID_VERIFICATION') {
        password.value = ''
        mode.value = 'invalid'
        await focusVerificationError()

        return
      }

      fields.value = parsedError.fields
      formError.value = parsedError.message
      await focusFirstError()
    } finally {
      isSubmitting.value = false
    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      --auth-form-gap: var(--space-5);
    }

    .form,
    .state {
      display: grid;
      gap: var(--auth-form-gap);
    }

    .notice,
    .formError,
    .stateMessage {
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-sm);
      background: var(--color-surface-muted);
    }

    .formError {
      color: var(--color-danger);
    }

    .primaryButton,
    .secondaryButton {
      min-block-size: 3.5rem;
      padding: var(--space-3) var(--space-6);
      border-radius: var(--radius-md);
      font-weight: 700;
      cursor: pointer;
      transition:
        filter var(--duration-fast) var(--ease-standard),
        transform var(--duration-fast) var(--ease-standard);
    }

    .primaryButton {
      border: 0;
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
    }

    .secondaryButton {
      border: 1px solid var(--color-border-strong);
      background: var(--color-surface);
      color: var(--color-text-primary);
    }

    .primaryButton:hover:not(:disabled),
    .secondaryButton:hover:not(:disabled) {
      filter: brightness(0.96);
    }

    .primaryButton:active:not(:disabled),
    .secondaryButton:active:not(:disabled) {
      transform: translateY(0.0625rem);
    }

    .primaryButton:disabled,
    .secondaryButton:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .stateLink,
    .footerLink {
      font-weight: 600;
      text-underline-offset: 0.2em;
    }

    .stateLink {
      justify-self: start;
    }
  }
</style>
