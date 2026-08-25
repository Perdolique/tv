interface AuthUser {
  id: string;
  email: string;
}

interface Credentials {
  email: string;
  password: string;
}

interface RegistrationRequest {
  email: string;
  redirectTo: string;
}

interface RegistrationCompletionEnvelope {
  password: unknown;
  token: string;
}

type AuthErrorCode =
  | 'BOT_VERIFICATION_FAILED'
  | 'INTERNAL_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REQUEST'
  | 'INVALID_VERIFICATION'
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
  Credentials,
  RegistrationCompletionEnvelope,
  RegistrationRequest
}
