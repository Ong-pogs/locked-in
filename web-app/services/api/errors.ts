export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Parsed error-response body, when the server sent JSON. Some contracts
   * carry data beyond message/code — e.g. 409 ENROLL_RETRY ships
   * `{ retryable, retryAfterMs }` (backend round-2 ruling R6). */
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
