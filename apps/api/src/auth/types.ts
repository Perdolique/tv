interface AuthUser {
  id: string;
  email: string;
}

interface Credentials {
  email: string;
  password: string;
}

type AuthErrorCode =
  | 'INTERNAL_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REQUEST'
  | 'PASSWORD_COMPROMISED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'

interface AuthErrorBody {
  code: AuthErrorCode;
  fields?: Record<string, string>;
  message: string;
}

interface AuthErrorEnvelope {
  error: AuthErrorBody;
}

export type {
  AuthErrorBody,
  AuthErrorCode,
  AuthErrorEnvelope,
  AuthUser,
  Credentials
}
