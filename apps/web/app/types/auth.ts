interface AuthUser {
  email: string;
  id: string;
}

interface AuthSessionResponse {
  user: AuthUser | null;
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
  fields: AuthFieldErrors;
  message: string;
}

interface RegistrationNotice {
  accepted: true;
  email: string;
}

export type {
  AuthFieldErrors,
  AuthSessionResponse,
  AuthSessionState,
  AuthUser,
  ParsedAuthError,
  RegistrationNotice
}
