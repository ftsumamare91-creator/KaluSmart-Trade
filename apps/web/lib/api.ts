export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Calls the API with the HttpOnly session cookie. The browser never sees the token itself. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (hasBody ? "POST" : "GET"),
    credentials: "include",
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...(opts.headers ?? {}) },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(", ") : data.message || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/** A key for one sale attempt. crypto.randomUUID is missing on plain-http pages, so fall back to random text. */
export const newIdempotencyKey = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 10)}`;

export const etb = (n?: number | string | null) =>
  n === undefined || n === null ? "—" : `ETB ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Files uploaded through the API are served from the API itself, under /api/products/... */
const UPLOADED_PREFIX = "/api/products/";
export const isUploaded = (url?: string | null) => !!url && url.startsWith(UPLOADED_PREFIX);

/** Turns an uploaded path into a full URL the browser can load; external links pass through unchanged. */
const API_ORIGIN = API.replace(/\/api\/?$/, "");
export const mediaSrc = (url?: string | null) => (!url ? "" : isUploaded(url) ? `${API_ORIGIN}${url}` : url);

function errorMessage(data: any, status: number) {
  return Array.isArray(data?.message) ? data.message.join(", ") : data?.message || `HTTP ${status}`;
}

/** Uploads an image or 3D model for a product. Returns the updated product. */
export async function uploadMedia<T = any>(productId: string, kind: "image" | "model3d", file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/products/${productId}/media/${kind}`, { method: "POST", credentials: "include", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status));
  return data as T;
}

export const deleteMedia = <T = any>(productId: string, kind: "image" | "model3d") =>
  api<T>(`/products/${productId}/media/${kind}`, { method: "DELETE" });
