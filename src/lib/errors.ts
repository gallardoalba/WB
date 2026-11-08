export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly retryAfter?: number;
  /** Valores para los `{marcadores}` del mensaje al traducirlo. */
  readonly vars?: Record<string, string | number>;

  constructor(
    status: number,
    message: string,
    options?: {
      retryAfter?: number;
      details?: unknown;
      vars?: Record<string, string | number>;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = options?.retryAfter;
    this.details = options?.details;
    this.vars = options?.vars;
  }
}
