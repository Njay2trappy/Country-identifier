export class ServiceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ServiceError';
    }
}
export function isServiceError(error) {
    return error instanceof ServiceError;
}
