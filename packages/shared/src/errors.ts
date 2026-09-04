interface SerializedError {
  message: string;
  name: string;
  stack?: string;
}

function findRootCause(error: unknown): unknown {
  const visitedErrors = new Set<Error>()
  let rootCause = error

  while (
    rootCause instanceof Error
    && rootCause.cause !== undefined
    && !visitedErrors.has(rootCause)
  ) {
    visitedErrors.add(rootCause)

    rootCause = rootCause.cause
  }

  return rootCause
}

function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      name: 'UnknownError'
    }
  }

  const serializedError: SerializedError = {
    message: error.message,
    name: error.name
  }

  if (error.stack !== undefined && error.stack !== '') {
    serializedError.stack = error.stack
  }

  return serializedError
}

export {
  findRootCause,
  serializeError
}

export type {
  SerializedError
}
