import { useRequestFetch, useState } from '#app'
import { isRecord } from '@tv/shared/type-guards'
import { computed } from 'vue'
import * as v from 'valibot'
import { useAuthSession } from './use-auth-session.ts'

const navigationResponseSchema = v.object({ allowed: v.boolean() })

type ImportAccessStatus = 'unknown' | 'allowed' | 'denied' | 'unauthorized' | 'error'

interface ImportAccessState {
  accountId: string | null;
  status: ImportAccessStatus;
}

function useCatalogImportAccess() {
  const state = useState<ImportAccessState>('catalog-import-access', () => {return {
    accountId: null,
    status: 'unknown'
  }})

  const requestFetch = useRequestFetch()
  const { state: session } = useAuthSession()
  const accountId = computed(() => session.value.status === 'authenticated' ? session.value.user.id : null)
  const canManage = computed(() => state.value.accountId === accountId.value && state.value.status === 'allowed')

  async function check(): Promise<ImportAccessStatus> {
    const currentAccountId = accountId.value

    if (currentAccountId === null) {
      state.value = {
        accountId: null,
        status: 'unauthorized'
      }

      return 'unauthorized'
    }

    try {
      await requestFetch('/api/catalog/imports/access', { retry: 0 })

      if (accountId.value === currentAccountId) {
        state.value = {
          accountId: currentAccountId,
          status: 'allowed'
        }
      }
    } catch (error) {
      if (accountId.value !== currentAccountId) {
        return state.value.status
      }

      const code = isRecord(error) ? error.statusCode : null
      let status: ImportAccessStatus = 'error'

      if (code === 401) {
        status = 'unauthorized'
      } else if (code === 403) {
        status = 'denied'
      }

      state.value = {
        accountId: currentAccountId,
        status
      }
    }

    return state.value.status
  }

  async function discover(): Promise<void> {
    const currentAccountId = accountId.value

    if (currentAccountId === null) {
      state.value = {
        accountId: null,
        status: 'unauthorized'
      }

      return
    }

    try {
      const body = await requestFetch('/api/catalog/imports/navigation', { retry: 0 })
      const { allowed } = v.parse(navigationResponseSchema, body)

      if (accountId.value === currentAccountId) {
        state.value = {
          accountId: currentAccountId,
          status: allowed ? 'allowed' : 'denied'
        }
      }
    } catch {
      if (accountId.value === currentAccountId) {
        state.value = {
          accountId: currentAccountId,
          status: 'error'
        }
      }
    }
  }

  function deny(): void {
    state.value = {
      accountId: accountId.value,
      status: 'denied'
    }
  }

  function unauthorize(): void {
    state.value = {
      accountId: accountId.value,
      status: 'unauthorized'
    }
  }

  return {
    accountId,
    canManage,
    check,
    discover,
    deny,
    unauthorize,
    state
  }
}

export { useCatalogImportAccess }
