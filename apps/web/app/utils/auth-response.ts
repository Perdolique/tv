import * as v from 'valibot'
import type { AuthUser } from '~/types/auth.ts'

const authUserSchema = v.object({
  email: v.string(),
  id: v.string()
}) satisfies v.GenericSchema<AuthUser, AuthUser>

const authSessionResponseSchema = v.object({
  user: v.nullable(authUserSchema)
})

const registrationResponseSchema = v.object({
  status: v.literal('accepted')
})

const registrationCompletionResponseSchema = v.object({
  email: v.string(),
  redirectTo: v.string(),
  status: v.literal('created')
})

const signInResponseSchema = v.object({
  user: authUserSchema
})

export {
  authSessionResponseSchema,
  registrationCompletionResponseSchema,
  registrationResponseSchema,
  signInResponseSchema
}
