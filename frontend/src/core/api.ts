import type { AuthState } from "./auth";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Fetch wrapper: attaches the Bearer token and normalizes errors. */
export async function api<T>(path: string, auth: AuthState | null, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
  if (init?.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status text
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}
