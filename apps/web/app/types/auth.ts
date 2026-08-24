interface AuthUser {
  email: string;
  id: string;
}

interface AuthenticatedSessionState {
  status: 'authenticated';
  user: AuthUser;
}

interface AnonymousSessionState {
  status: 'anonymous';
}

interface ErrorSessionState {
  status: 'error';
}

interface UnknownSessionState {
  status: 'unknown';
}

type AuthSessionState =
  | AnonymousSessionState
  | AuthenticatedSessionState
  | ErrorSessionState
  | UnknownSessionState

interface AuthFieldErrors {
  email?: string;
  password?: string;
}

interface ParsedAuthError {
  code?: AuthErrorCode;
  fields: AuthFieldErrors;
  message: string;
}

interface RegistrationNotice {
  created: true;
  email: string;
}

type AuthErrorCode =
  | 'INTERNAL_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REQUEST'
  | 'INVALID_VERIFICATION'
  | 'PASSWORD_COMPROMISED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'

export type {
  AuthFieldErrors,
  AuthErrorCode,
  AuthSessionState,
  AuthUser,
  ParsedAuthError,
  RegistrationNotice
}
