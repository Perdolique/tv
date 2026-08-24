import type { Database } from '@tv/database'
import { emailVerificationTokens, passwordCredentials, sessions, users } from '@tv/database/schema'
import { and, eq, gt, lte, sql } from 'drizzle-orm'
import type { AuthUser } from './types.ts'

interface PasswordCredential {
  passwordHash: string;
  user: AuthUser;
}

interface IssueVerificationTokenInput {
  email: string;
  expiresAt: Date;
  redirectTo: string;
  tokenHash: string;
}

async function issueVerificationToken(
  database: Database,
  input: IssueVerificationTokenInput,
  now: Date
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${input.email}, 0))
    `)

    await transaction
      .delete(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.email, input.email),
          lte(emailVerificationTokens.expiresAt, now)
        )
      )

    const existingUsers = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1)

    if (existingUsers.length > 0) {
      return false
    }

    await transaction.insert(emailVerificationTokens).values(input)

    return true
  })
}

interface VerificationTokenRecord {
  email: string;
  redirectTo: string;
}

async function findValidVerificationToken(
  database: Database,
  tokenHash: string,
  now: Date
): Promise<VerificationTokenRecord | null> {
  const rows = await database
    .select({
      email: emailVerificationTokens.email,
      redirectTo: emailVerificationTokens.redirectTo
    })
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, tokenHash),
        gt(emailVerificationTokens.expiresAt, now)
      )
    )
    .limit(1)

  return rows[0] ?? null
}

interface CompleteRegistrationInput {
  email: string;
  passwordHash: string;
  tokenHash: string;
}

async function completeRegistration(
  database: Database,
  input: CompleteRegistrationInput,
  now: Date
): Promise<VerificationTokenRecord | null> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${input.email}, 0))
    `)

    const consumedTokens = await transaction
      .delete(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.email, input.email),
          eq(emailVerificationTokens.tokenHash, input.tokenHash),
          gt(emailVerificationTokens.expiresAt, now)
        )
      )
      .returning({
        email: emailVerificationTokens.email,
        redirectTo: emailVerificationTokens.redirectTo
      })

    const [consumedToken] = consumedTokens

    if (!consumedToken) {
      return null
    }

    const insertedUsers = await transaction
      .insert(users)
      .values({ email: input.email })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id })

    const [insertedUser] = insertedUsers

    if (!insertedUser) {
      return null
    }

    await transaction.insert(passwordCredentials).values({
      passwordHash: input.passwordHash,
      userId: insertedUser.id
    })

    await transaction
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.email, input.email))

    return consumedToken
  })
}

async function deleteVerificationToken(
  database: Database,
  tokenHash: string
): Promise<void> {
  await database
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
}

async function findPasswordCredential(
  database: Database,
  email: string
): Promise<PasswordCredential | null> {
  const rows = await database
    .select({
      email: users.email,
      passwordHash: passwordCredentials.passwordHash,
      userId: users.id
    })
    .from(users)
    .innerJoin(
      passwordCredentials,
      eq(passwordCredentials.userId, users.id)
    )
    .where(
      eq(users.email, email)
    )
    .limit(1)

  const [row] = rows

  if (!row) {
    return null
  }

  return {
    passwordHash: row.passwordHash,

    user: {
      email: row.email,
      id: row.userId
    }
  }
}

interface CreateSessionInput {
  currentTokenHash: string | undefined;
  expiresAt: Date;
  tokenHash: string;
  userId: string;
}

async function createSession(
  database: Database,
  input: CreateSessionInput,
  now: Date
): Promise<void> {
  await database
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, input.userId),
        lte(sessions.expiresAt, now)
      )
    )

  await database.transaction(async (transaction) => {
    if (input.currentTokenHash !== undefined) {
      await transaction
        .delete(sessions)
        .where(
          eq(sessions.tokenHash, input.currentTokenHash)
        )
    }

    await transaction.insert(sessions).values({
      expiresAt: input.expiresAt,
      tokenHash: input.tokenHash,
      userId: input.userId
    })
  })
}

async function deleteSession(
  database: Database,
  tokenHash: string
): Promise<void> {
  await database
    .delete(sessions)
    .where(
      eq(sessions.tokenHash, tokenHash)
    )
}

async function findUserBySession(
  database: Database,
  tokenHash: string,
  now: Date
): Promise<AuthUser | null> {
  const rows = await database
    .select({
      email: users.email,
      expiresAt: sessions.expiresAt,
      userId: users.id
    })
    .from(sessions)
    .innerJoin(
      users,
      eq(users.id, sessions.userId)
    )
    .where(
      eq(sessions.tokenHash, tokenHash)
    )
    .limit(1)

  const [row] = rows

  if (!row) {
    return null
  }

  if (row.expiresAt <= now) {
    await deleteSession(database, tokenHash)

    return null
  }

  return {
    email: row.email,
    id: row.userId
  }
}

export type { PasswordCredential }

export {
  completeRegistration,
  createSession,
  deleteVerificationToken,
  deleteSession,
  findPasswordCredential,
  findUserBySession,
  findValidVerificationToken,
  issueVerificationToken
}
