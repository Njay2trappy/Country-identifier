export type ServiceErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'EXTERNAL_API' | 'INTERNAL';

export class ServiceError extends Error {
  constructor(public readonly code: ServiceErrorCode, message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
