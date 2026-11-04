export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly retryAfter?: number;

  constructor(status: number, message: string, options?: { retryAfter?: number; details?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = options?.retryAfter;
    this.details = options?.details;
  }
}
