<template>
  <AuthCard :title="title">
    <template #notice>
      <p
        v-if="hasSessionWarning"
        role="status"
      >
        We couldn’t verify your current session. You can still register.
      </p>
    </template>

    <form
      v-if="showsEmailForm"
      novalidate
      @submit.prevent="requestVerification"
    >
      <div>
        <label :for="emailId">
          Email
        </label>

        <input
          :id="emailId"
          ref="emailInput"
          v-model="email"
          :aria-describedby="emailDescribedBy"
          :aria-invalid="isEmailInvalid"
          autocomplete="email"
          inputmode="email"
          required
          type="email"
        >

        <p v-if="isEmailInvalid" :id="emailErrorId">
          {{ emailError }}
        </p>
      </div>

      <p
        v-if="hasFormError"
        ref="formError"
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

      <button :disabled="isEmailSubmitDisabled" type="submit">
        Email me a verification link
      </button>
    </form>

    <div v-else-if="showsCheckEmail">
      <p role="status">
        Check your email for the next step. If the address can be used, a message is on its way.
      </p>

      <button type="button" @click="startAgain">
        Use a different email
      </button>
    </div>

    <form
      v-else-if="showsPasswordForm"
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
        role="alert"
        tabindex="-1"
      >
        {{ formError }}
      </p>

      <button :disabled="isSubmitting" type="submit">
        Create account
      </button>
    </form>

    <div v-else>
      <p
        ref="verificationError"
        role="alert"
        tabindex="-1"
      >
        This verification link is invalid or has expired.
      </p>

      <NuxtLink :to="registerLocation" @click="startAgain">
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
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
  import AuthCard from '~/components/auth/AuthCard.vue'
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
  const emailInput = useTemplateRef('emailInput')
  const passwordField = useTemplateRef('passwordField')
  const turnstileWidget = useTemplateRef('turnstileWidget')
  const formErrorElement = useTemplateRef('formError')
  const verificationError = useTemplateRef('verificationError')
  const emailId = useId()
  const emailErrorId = useId()
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
  const isEmailInvalid = computed(() => emailError.value !== undefined)
  const emailDescribedBy = computed(() => isEmailInvalid.value ? emailErrorId : undefined)
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
      emailInput.value?.focus()

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
    emailInput.value?.focus()
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
