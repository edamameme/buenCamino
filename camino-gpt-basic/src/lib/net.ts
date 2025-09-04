// lib/net.ts
export type RetryOpts = {
  timeoutMs?: number;     // per attempt
  retries?: number;       // extra tries after the first
  baseDelayMs?: number;   // backoff base
};

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 1000000
) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export async function postJsonWithRetry<TReq, TRes>(
  url: string,
  body: TReq,
  opts: RetryOpts = {}
): Promise<TRes> {
  const {
    timeoutMs = 1000000,
    retries = 1,
    baseDelayMs = 800,
  } = opts;

  let attempt = 0;
  let lastErr: any;

  while (attempt <= retries) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as TRes;
    } catch (e) {
      lastErr = e;
      attempt++;
      if (attempt > retries) break;
      // jittered backoff
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
