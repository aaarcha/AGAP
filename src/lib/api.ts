const TOKEN_KEY = "agap.token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  status: number;
  code: string;
  /** true when the request never reached the server (offline, DNS, server asleep…) */
  network: boolean;
  constructor(status: number, code: string, message: string, network = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.network = network;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server.", true);
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    // Render's proxy answers 502/503/504 while a sleeping free instance wakes up – treat as "no connection".
    const network = res.status === 502 || res.status === 503 || res.status === 504;
    throw new ApiError(res.status, json?.error || "error", json?.message || `Request failed (${res.status})`, network);
  }
  return json as T;
}
