export class HttpError extends Error {
  constructor(statusCode, message, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message, code = 'BAD_REQUEST') {
  return new HttpError(400, message, code);
}

export function unauthorized(message, code = 'UNAUTHORIZED') {
  return new HttpError(401, message, code);
}

export function notFound(message, code = 'NOT_FOUND') {
  return new HttpError(404, message, code);
}
