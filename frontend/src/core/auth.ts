import type { Scope } from "./types";

const TOKEN_KEY = "gsiv.token";

/** Auth state: the raw token + the scopes it grants (parsed like AUTH_TOKENS). */
export interface AuthState {
  token: string;
  name: string;
  scopes: Scope[];
}

export function loadAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function saveAuth(state: AuthState): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(state));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function can(auth: AuthState | null, scopes: Scope[]): boolean {
  if (!auth) return false;
  if (auth.scopes.includes("*")) return true;
  return scopes.every((s) => auth.scopes.includes(s));
}
