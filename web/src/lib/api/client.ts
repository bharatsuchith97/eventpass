export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  /** Field-level messages from a VALIDATION_ERROR, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const d = this.details as { issues?: { field: string; message: string }[] } | undefined;
    return Object.fromEntries((d?.issues ?? []).map((i) => [i.field, i.message]));
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

async function request(path: string, { method = 'GET', body }: Options): Promise<Response> {
  let res: Response;
  try {
    // A File/Blob (e.g. a logo upload) is sent as-is with its own type; anything else as JSON.
    const raw = body instanceof Blob;
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': raw ? body.type : 'application/json', 'X-Requested-With': 'eventpass' },
      body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? 'Something went wrong', data?.error?.details);
  }
  return res;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const res = await request(path, options);
  return (await res.json()) as T;
}

/** Fetch a binary/CSV response and hand it to the browser as a file download. */
export async function download(path: string, fallbackName: string, options: Options = {}): Promise<void> {
  const res = await request(path, options);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const qs = (params: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
