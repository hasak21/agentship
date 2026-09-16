import { timingSafeEqual } from "node:crypto";

export class HttpGuardError extends Error {
  constructor(
    public readonly status: 400 | 401 | 413 | 415,
    message: string
  ) {
    super(message);
    this.name = "HttpGuardError";
  }
}

export function requireApiAccess(request: Request): void {
  const expected = process.env.AGENTSHIP_API_TOKEN;
  if (!expected) return;

  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!safeEqual(supplied, expected)) {
    throw new HttpGuardError(401, "Authentication required.");
  }
}

export async function readBoundedJsonObject(
  request: Request,
  maximumBytes: number
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw new HttpGuardError(415, "Content-Type must be application/json.");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maximumBytes) {
      throw new HttpGuardError(413, `Request body exceeds ${maximumBytes} bytes.`);
    }
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new HttpGuardError(413, `Request body exceeds ${maximumBytes} bytes.`);
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpGuardError(400, "Request body must contain valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpGuardError(400, "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function guardErrorResponse(error: HttpGuardError): Response {
  return Response.json(
    { error: error.message },
    {
      status: error.status,
      headers: error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
    }
  );
}

function safeEqual(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(suppliedBytes, expectedBytes);
}
