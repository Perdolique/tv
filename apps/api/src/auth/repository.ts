import type { Database } from '@tv/database'
import { passwordCredentials, sessions, users } from '@tv/database/schema'
import { and, eq, lte } from 'drizzle-orm'
import type { AuthUser } from './types.ts'

interface PasswordCredential {
  passwordHash: string;
  user: AuthUser;
}

async function registerUser(
  database: Database,
  email: string,
  passwordHash: string
): Promise<void> {
  await database.transaction(async (transaction) => {
    const insertedUsers = await transaction
      .insert(users)
      .values({ email })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id })

    const [insertedUser] = insertedUsers

    if (!insertedUser) {
      return
    }

    await transaction.insert(passwordCredentials).values({
      passwordHash,
      userId: insertedUser.id
    })
  })
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
  createSession,
  deleteSession,
  findPasswordCredential,
  findUserBySession,
  registerUser
}
