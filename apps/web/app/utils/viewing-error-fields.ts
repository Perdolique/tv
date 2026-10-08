import { isRecord } from '@tv/shared/type-guards'

function viewingErrorFields(error: unknown): Record<string, string> {
  const isErrorRecord = isRecord(error)

  if (!isErrorRecord) {
    return {}
  }

  const { data } = error
  const isDataRecord = isRecord(data)

  if (!isDataRecord) {
    return {}
  }

  const detail = data.error
  const isDetailRecord = isRecord(detail)

  if (!isDetailRecord) {
    return {}
  }

  const errorFields = detail.fields
  const isFieldsRecord = isRecord(errorFields)

  if (!isFieldsRecord) {
    return {}
  }

  const fields: Record<string, string> = {}
  const entries = Object.entries(errorFields)

  for (const [name, message] of entries) {
    if (typeof message === 'string') { fields[name] = message }
  }

  return fields
}
export { viewingErrorFields }
