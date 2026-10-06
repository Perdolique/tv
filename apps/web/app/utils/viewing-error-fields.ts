import { isRecord } from '@tv/shared/type-guards'

function viewingErrorFields(error: unknown): Record<string, string> {
  if (!isRecord(error) || !isRecord(error.data) || !isRecord(error.data.error) || !isRecord(error.data.error.fields)) {
    return {}
  }

  const fields: Record<string, string> = {}
  const entries = Object.entries(error.data.error.fields)

  for (const [name, message] of entries) {
    if (typeof message === 'string') { fields[name] = message }
  }

  return fields
}
export { viewingErrorFields }
