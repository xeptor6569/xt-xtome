export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, `${label} must be a UUID.`);
  }
  return value;
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Expected a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "Expected text.");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function requireText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (!text) {
    throw new HttpError(400, `${label} is required.`);
  }
  return text;
}

export function isPgError(error: unknown): error is { code: string; message: string } {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

export function rethrowAsHttp(error: unknown): never {
  if (error instanceof HttpError) {
    throw error;
  }
  if (isPgError(error)) {
    if (error.code === "23505") {
      throw new HttpError(409, "That record already exists.");
    }
    if (error.code === "23503") {
      throw new HttpError(400, "That reference does not exist.");
    }
    if (error.code === "23514" || error.code === "P0001") {
      throw new HttpError(400, error.message);
    }
  }
  throw error;
}
