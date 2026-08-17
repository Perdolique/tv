<script setup lang="ts">
import { definePageMeta } from '#app/composables/pages'
import { navigateTo, useHead, useRequestFetch, useRoute, useState } from '#app'
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue'
import AuthCard from '~/components/auth/AuthCard.vue'
import PasswordField from '~/components/auth/PasswordField.vue'
import { useAuthSession } from '~/composables/use-auth-session.ts'
import type { AuthFieldErrors, RegistrationNotice } from '~/types/auth.ts'
import { getFetchErrorData, parseAuthError } from '~/utils/auth-error.ts'
import { validateRegistration } from '~/utils/auth-validation.ts'
import { sanitizeRedirectTo } from '~/utils/redirect.ts'

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
const passwordConfirmation = ref('')
const fields = ref<AuthFieldErrors>({})
const formError = ref('')
const isSubmitting = ref(false)
const arePasswordsVisible = ref(false)
const emailInput = useTemplateRef('emailInput')
const passwordField = useTemplateRef('passwordField')
const confirmationField = useTemplateRef('confirmationField')
const formErrorElement = useTemplateRef('formError')
const emailId = useId()
const emailErrorId = useId()
const redirectTo = computed(() => sanitizeRedirectTo(route.query.redirectTo))

const signInLocation = computed(() => {
  return {
    path: '/sign-in',
    query: { redirectTo: redirectTo.value }
  }
})

const emailError = computed(() => fields.value.email)
const passwordError = computed(() => fields.value.password)
const confirmationError = computed(() => fields.value.passwordConfirmation)
const isEmailInvalid = computed(() => emailError.value !== undefined)
const emailDescribedBy = computed(() => isEmailInvalid.value ? emailErrorId : undefined)
const hasFormError = computed(() => formError.value !== '')
const hasSessionWarning = computed(() => state.value.status === 'error')

const passwordToggleLabel = computed(() => arePasswordsVisible.value
  ? 'Hide passwords'
  : 'Show passwords')

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

  if (confirmationError.value !== undefined) {
    confirmationField.value?.focus()
    return
  }

  formErrorElement.value?.focus()
}

function togglePasswordVisibility(): void {
  arePasswordsVisible.value = !arePasswordsVisible.value
}

async function submit(): Promise<void> {
  formError.value = ''
  fields.value = {}

  const validation = validateRegistration({
    email: email.value,
    password: password.value,
    passwordConfirmation: passwordConfirmation.value
  })

  if (validation.payload === null) {
    fields.value = validation.fields
    await focusFirstError()
    return
  }

  isSubmitting.value = true

  try {
    await requestFetch('/api/auth/register', {
      body: validation.payload,
      method: 'POST'
    })

    password.value = ''
    passwordConfirmation.value = ''
    registrationNotice.value = {
      accepted: true,
      email: validation.payload.email
    }

    await navigateTo(signInLocation.value)
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

<template>
  <AuthCard
    description="Create an account to start building your TV experience."
    title="Create your account"
  >
    <template #notice>
      <p
        v-if="hasSessionWarning"
        :class="$style.warningNotice"
        role="status"
      >
        We couldn’t verify your current session. You can still register.
      </p>
    </template>

    <form :class="$style.form" novalidate @submit.prevent="submit">
      <div :class="$style.field">
        <label :class="$style.label" :for="emailId">
          Email
        </label>

        <input
          :id="emailId"
          ref="emailInput"
          v-model="email"
          :aria-describedby="emailDescribedBy"
          :aria-invalid="isEmailInvalid"
          autocomplete="email"
          :class="$style.input"
          inputmode="email"
          required
          type="email"
        >

        <p v-if="isEmailInvalid" :id="emailErrorId" :class="$style.fieldError">
          {{ emailError }}
        </p>
      </div>

      <PasswordField
        ref="passwordField"
        v-model="password"
        autocomplete="new-password"
        :error="passwordError"
        hint="Use between 15 and 128 characters."
        label="Password"
        :toggle-label="passwordToggleLabel"
        :visible="arePasswordsVisible"
        @toggle="togglePasswordVisibility"
      />

      <PasswordField
        ref="confirmationField"
        v-model="passwordConfirmation"
        autocomplete="new-password"
        :error="confirmationError"
        label="Confirm password"
        :visible="arePasswordsVisible"
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

      <button :class="$style.submit" :disabled="isSubmitting" type="submit">
        Create account
      </button>
    </form>

    <template #footer>
      Already have an account?
      <NuxtLink :class="$style.link" :to="signInLocation">
        Sign in
      </NuxtLink>
    </template>
  </AuthCard>
</template>

<style module>
.form {
  display: grid;
  gap: 1.25rem;
  margin-block-start: 1.75rem;
}

.field {
  display: grid;
  gap: 0.5rem;
}

.label {
  color: #e5e7eb;
  font-size: 0.9375rem;
  font-weight: 700;
}

.input {
  inline-size: 100%;
  min-block-size: 2.875rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid #3b485d;
  border-radius: 0.625rem;
  background: #0b1220;
  color: #f8fafc;
  font: inherit;
}

.input[aria-invalid='true'] {
  border-color: #f87171;
}

.input:focus-visible,
.formError:focus-visible,
.submit:focus-visible,
.link:focus-visible {
  outline: 3px solid #60a5fa;
  outline-offset: 2px;
}

.fieldError,
.formError {
  color: #fca5a5;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.warningNotice {
  margin-block-start: 1.25rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid #92400e;
  border-radius: 0.625rem;
  background: #451a03;
  color: #fde68a;
  font-size: 0.875rem;
  line-height: 1.45;
}

.formError {
  padding: 0.75rem;
  border: 1px solid #991b1b;
  border-radius: 0.625rem;
  background: #450a0a;
}

.submit {
  min-block-size: 2.875rem;
  padding: 0.7rem 1rem;
  border: 0;
  border-radius: 0.625rem;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 800;
}

.submit:hover:not(:disabled) {
  background: #1d4ed8;
}

.submit:disabled {
  cursor: wait;
  opacity: 0.65;
}

.link {
  color: #93c5fd;
  font-weight: 700;
}
</style>
