import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

const users = pgTable('users', {
  id:
    uuid()
    .defaultRandom()
    .primaryKey(),

  email:
    varchar({ length: 254 })
    .notNull(),

  createdAt:
    timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull(),

  updatedAt:
    timestamp('updated_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull()
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email)
])

const passwordCredentials = pgTable('password_credentials', {
  userId:
    uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  passwordHash:
    varchar('password_hash', { length: 256 })
    .notNull(),

  createdAt:
    timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull(),

  updatedAt:
    timestamp('updated_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull()
})

const emailVerificationTokens = pgTable('email_verification_tokens', {
  tokenHash:
    varchar('token_hash', { length: 64 })
    .primaryKey(),

  email:
    varchar({ length: 254 })
    .notNull(),

  redirectTo:
    text('redirect_to')
    .notNull(),

  createdAt:
    timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull(),

  expiresAt:
    timestamp('expires_at', {
      mode: 'date',
      withTimezone: true
    })
    .notNull()
}, (table) => [
  index('email_verification_tokens_email_index').on(table.email),
  index('email_verification_tokens_expires_at_index').on(table.expiresAt)
])

const sessions = pgTable('sessions', {
  id:
    uuid()
    .defaultRandom()
    .primaryKey(),

  userId:
    uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  tokenHash:
    varchar('token_hash', { length: 64 })
    .notNull(),

  createdAt:
    timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull(),

  expiresAt:
    timestamp('expires_at', {
      mode: 'date',
      withTimezone: true
    })
    .notNull()
}, (table) => [
  uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
  index('sessions_user_id_index').on(table.userId),
  index('sessions_expires_at_index').on(table.expiresAt)
])

export {
  emailVerificationTokens,
  passwordCredentials,
  sessions,
  users
}
