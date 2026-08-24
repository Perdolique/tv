<template>
  <AuthCard title="Welcome back">
    <template #notice>
      <p
        v-if="showsRegistrationNotice"
        role="status"
      >
        Account created. Sign in to continue.
      </p>

      <p
        v-if="hasSessionWarning"
        role="status"
      >
        We couldn’t verify your current session. You can still sign in.
      </p>
    </template>

    <form novalidate @submit.prevent="submit">
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

      <PasswordField
        ref="passwordField"
        v-model="password"
        autocomplete="current-password"
        :error="passwordError"
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
        Sign in
      </button>
    </form>

    <template #footer>
      New to TV?
      <NuxtLink :to="registerLocation">
        Create an account
      </NuxtLink>
    </template>
  </AuthCard>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useRequestFetch, useRoute, useState } from '#app'
  import * as v from 'valibot'
  import { computed, nextTick, ref, useId, useTemplateRef } from 'vue'
  import AuthCard from '~/components/auth/AuthCard.vue'
  import PasswordField from '~/components/auth/PasswordField.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import type { AuthFieldErrors, RegistrationNotice } from '~/types/auth.ts'
  import { getFetchErrorData, parseAuthError } from '~/utils/auth-error.ts'
  import { signInResponseSchema } from '~/utils/auth-response.ts'
  import { validateCredentials } from '~/utils/auth-validation.ts'
  import { sanitizeRedirectTo } from '~/utils/redirect.ts'

  definePageMeta({ middleware: 'guest' })
  useHead({ title: 'Sign in · TV' })

  const route = useRoute()
  const requestFetch = useRequestFetch()
  const { setAuthenticated, state } = useAuthSession()

  const registrationNotice = useState<RegistrationNotice | null>(
    'registration-notice',
    () => null
  )

  const initialNotice = registrationNotice.value
  const email = ref(initialNotice?.email ?? '')
  const password = ref('')
  const fields = ref<AuthFieldErrors>({})
  const formError = ref('')
  const isSubmitting = ref(false)
  const isPasswordVisible = ref(false)
  const showsRegistrationNotice = ref(initialNotice?.created === true)

  registrationNotice.value = null

  const emailInput = useTemplateRef('emailInput')
  const passwordField = useTemplateRef('passwordField')
  const formErrorElement = useTemplateRef('formError')
  const emailId = useId()
  const emailErrorId = useId()
  const redirectTo = computed(() => sanitizeRedirectTo(route.query.redirectTo))

  const registerLocation = computed(() => {
    return {
      path: '/register',
      query: { redirectTo: redirectTo.value }
    }
  })

  const emailError = computed(() => fields.value.email)
  const passwordError = computed(() => fields.value.password)
  const isEmailInvalid = computed(() => emailError.value !== undefined)
  const emailDescribedBy = computed(() => isEmailInvalid.value ? emailErrorId : undefined)
  const hasFormError = computed(() => formError.value !== '')
  const hasSessionWarning = computed(() => state.value.status === 'error')

  const passwordToggleLabel = computed(() => isPasswordVisible.value
    ? 'Hide password'
    : 'Show password')

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

  function togglePasswordVisibility(): void {
    isPasswordVisible.value = !isPasswordVisible.value
  }

  async function submit(): Promise<void> {
    formError.value = ''
    fields.value = {}

    const validation = validateCredentials(email.value, password.value)

    if (validation.payload === null) {
      fields.value = validation.fields
      await focusFirstError()

      return
    }

    isSubmitting.value = true

    try {
      const response = await requestFetch('/api/auth/sign-in', {
        body: validation.payload,
        method: 'POST'
      })

      const { user } = v.parse(signInResponseSchema, response)

      setAuthenticated(user)
      await navigateTo(redirectTo.value, { replace: true })
    } catch (error) {
      const parsedError = parseAuthError(getFetchErrorData(error))

      fields.value = parsedError.fields
      formError.value = parsedError.message
      await focusFirstError()
    } finally {
      isSubmitting.value = false
    }
  }
</script>
