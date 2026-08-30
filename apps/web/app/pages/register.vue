<template>
  <AuthCard
    description="Build your watchlist in a minute."
    :marketing-items="registerMarketingItems"
    marketing-title="Your next obsession starts here."
    :title="title"
  >
    <template v-if="hasSessionWarning" #notice>
      <AppMessage role="status">
        We couldn’t verify your current session. You can still register.
      </AppMessage>
    </template>

    <AuthForm
      v-if="showsEmailForm"
      :disabled="isEmailSubmitDisabled"
      submit-label="Email me a verification link"
      @submit="requestVerification"
    >
      <AuthTextField
        ref="emailField"
        v-model="email"
        autocomplete="email"
        :error="emailError"
        inputmode="email"
        label="Email"
        type="email"
      />

      <AppMessage
        v-if="hasFormError"
        ref="formError"
        role="alert"
        tabindex="-1"
        tone="danger"
      >
        {{ formError }}
      </AppMessage>

      <TurnstileWidget
        ref="turnstileWidget"
        v-model="turnstileToken"
        :action="TURNSTILE_ACTIONS.register"
      />

    </AuthForm>

    <div v-else-if="showsCheckEmail" :class="$style.state">
      <AppMessage role="status">
        Check your email for the next step. If the address can be used, a message is on its way.
      </AppMessage>

      <AppButton variant="secondary" @click="startAgain">
        Use a different email
      </AppButton>
    </div>

    <AuthForm
      v-else-if="showsPasswordForm"
      :disabled="isSubmitting"
      submit-label="Create account"
      @submit="completeRegistration"
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

      <AppMessage
        v-if="hasFormError"
        ref="formError"
        role="alert"
        tabindex="-1"
        tone="danger"
      >
        {{ formError }}
      </AppMessage>
    </AuthForm>

    <div v-else :class="$style.state">
      <AppMessage
        ref="verificationError"
        role="alert"
        tabindex="-1"
        tone="danger"
      >
        This verification link is invalid or has expired.
      </AppMessage>

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
      <NuxtLink :to="signInLocation">
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
  import AuthForm from '~/components/auth/AuthForm.vue'
  import AuthTextField from '~/components/auth/AuthTextField.vue'
  import PasswordField from '~/components/auth/PasswordField.vue'
  import TurnstileWidget from '~/components/auth/TurnstileWidget.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
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
  const requestCancellation = useRequestCancellation()

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
    if (isSubmitting.value) {
      return
    }

    resetErrors()

    const validation = validateEmail(email.value)

    if (validation.payload === null) {
      fields.value = validation.fields
      await focusFirstError()

      return
    }

    isSubmitting.value = true

    const controller = requestCancellation.start()

    try {
      const response = await requestFetch('/api/auth/register', {
        body: {
          [TURNSTILE_RESPONSE_FIELD]: turnstileToken.value,
          email: validation.payload.email,
          redirectTo: redirectTo.value
        },

        method: 'POST',
        signal: controller.signal
      })

      if (!requestCancellation.isCurrent(controller)) {
        return
      }

      v.parse(registrationResponseSchema, response)
      mode.value = 'check-email'
    } catch (error) {
      if (!requestCancellation.isCurrent(controller)) {
        return
      }

      const parsedError = parseAuthError(getFetchErrorData(error))

      fields.value = parsedError.fields
      formError.value = parsedError.message
      await focusFirstError()
    } finally {
      if (requestCancellation.finish(controller)) {
        turnstileWidget.value?.reset()
        isSubmitting.value = false
      }
    }
  }

  async function completeRegistration(): Promise<void> {
    if (isSubmitting.value) {
      return
    }

    resetErrors()

    const validation = validatePassword(password.value)

    if (validation.payload === null) {
      fields.value = validation.fields
      await focusFirstError()

      return
    }

    isSubmitting.value = true

    const controller = requestCancellation.start()

    try {
      const response = await requestFetch('/api/auth/register/complete', {
        body: {
          password: validation.payload.password,
          token: token.value
        },

        method: 'POST',
        signal: controller.signal
      })

      if (!requestCancellation.isCurrent(controller)) {
        return
      }

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
      if (!requestCancellation.isCurrent(controller)) {
        return
      }

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
      if (requestCancellation.finish(controller)) {
        isSubmitting.value = false
      }
    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .state {
      display: grid;
      gap: var(--space-5);
    }

    .stateLink {
      font-weight: 600;
      text-underline-offset: 0.2em;
      justify-self: start;
    }
  }
</style>
