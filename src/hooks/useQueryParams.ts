"use client";

/**
 * The page's query string, read on the client.
 *
 * Next.js's `searchParams` prop cannot be used here: on a statically
 * prerendered route it reaches the client component as a plain `{}` rather than
 * a Promise, so awaiting it throws in production and silently sends every
 * customer who scanned a QR code to the fallback table picker.
 *
 * `window.location.search` is identical in dev and production, and reading it in
 * an effect keeps it out of the server render entirely.
 */

import { useEffect, useState } from "react";

/** `null` until mounted, so the first paint can show a loader. */
export type QueryParams = Readonly<Record<string, string>> | null;

export function useQueryParams(): QueryParams {
  const [params, setParams] = useState<QueryParams>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const next: Record<string, string> = {};
    search.forEach((value, key) => {
      next[key] = value;
    });
    setParams(next);
  }, []);

  return params;
}
