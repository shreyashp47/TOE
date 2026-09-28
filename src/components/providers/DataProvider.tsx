"use client";

/**
 * Storage context + subscription hooks.
 *
 * Every read in the app goes through here, which means:
 *  - switching backends is a one-line change in /lib/data
 *  - components never import the SDK directly
 *  - `useSyncExternalStore` gives tear-free live updates for free
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { getTableNumbers, isDemoMode } from "@/lib/config";
import { demoBundle, loadBundle, type DataBundle } from "@/lib/data";
import type {
  AuthRepository,
  ConfigRepository,
  MenuRepository,
  OrderRepository,
  StaffUser,
} from "@/lib/data/types";
import type { MenuItem, Order, SpecialOffer } from "@/lib/types";

interface DataContextValue {
  bundle: DataBundle | null;
  loading: boolean;
  error: Error | null;
}

const DataContext = createContext<DataContextValue>({
  bundle: null,
  loading: true,
  error: null,
});

export function DataProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<DataContextValue>(() => ({
    bundle: isDemoMode ? demoBundle : null,
    loading: !isDemoMode,
    error: null,
  }));

  useEffect(() => {
    if (isDemoMode) return;
    let alive = true;
    loadBundle()
      .then((bundle) => {
        if (alive) setValue({ bundle, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (alive) {
          setValue({
            bundle: null,
            loading: false,
            error:
              error instanceof Error
                ? error
                : new Error("Could not reach Firebase."),
          });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function useData(): DataContextValue {
  return useContext(DataContext);
}

export function useIsDemo(): boolean {
  return useData().bundle?.isDemo ?? isDemoMode;
}

export function useMenuRepo(): MenuRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.menu ?? null, [bundle]);
}

export function useOrderRepo(): OrderRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.orders ?? null, [bundle]);
}

export function useAuthRepo(): AuthRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.auth ?? null, [bundle]);
}

export function useConfigRepo(): ConfigRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.config ?? null, [bundle]);
}

/** Generic live subscription bridged onto useSyncExternalStore. */
function useLive<T>(
  subscribe: ((listener: (value: T) => void) => () => void) | null,
  initial: T,
): { value: T; ready: boolean } {
  const cache = useRef<{ value: T }>({ value: initial });
  const listeners = useRef(new Set<() => void>());

  const subscribeFn = useCallback(
    (onStoreChange: () => void) => {
      if (!subscribe) return () => {};
      listeners.current.add(onStoreChange);
      return () => {
        listeners.current.delete(onStoreChange);
      };
    },
    [subscribe],
  );

  const getSnapshot = useCallback(() => cache.current.value, []);

  const value = useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!subscribe) return;
    let alive = true;
    const off = subscribe((next) => {
      if (!alive) return;
      cache.current = { value: next };
      listeners.current.forEach((l) => l());
    });
    return () => {
      alive = false;
      off();
    };
  }, [subscribe]);

  return { value, ready: Boolean(subscribe) };
}

// --- domain hooks -----------------------------------------------------------

export function useMenu(): {
  items: MenuItem[];
  loading: boolean;
  error: Error | null;
} {
  const repo = useMenuRepo();
  const [error, setError] = useState<Error | null>(null);

  const subscribe = useMemo(
    () =>
      repo
        ? (listener: (items: MenuItem[]) => void) =>
            repo.subscribe(listener, setError)
        : null,
    [repo],
  );

  const { value } = useLive<MenuItem[]>(subscribe, []);
  return { items: value, loading: !repo, error };
}

/**
 * `enabled` exists because the staff board used to subscribe before anyone had
 * signed in. The order rules only let a *staff* account list orders, so that
 * first listener was refused, the page showed "Live updates dropped: Missing or
 * insufficient permissions", and because the subscription is created once it was
 * never retried — the board stayed empty for a correctly signed-in barista. Every
 * network request afterwards succeeded; the page was showing a failure from
 * before the session existed.
 */
export function useActiveOrders(enabled = true): {
  orders: Order[];
  loading: boolean;
  error: Error | null;
} {
  const repo = useOrderRepo();
  const [error, setError] = useState<Error | null>(null);

  const subscribe = useMemo(() => {
    if (!repo || !enabled) return null;
    return (listener: (orders: Order[]) => void) =>
      repo.subscribeActive((orders) => {
        // A good snapshot clears a bad one, so a single dropped connection does
        // not leave a permanent banner sitting above a working board.
        setError(null);
        listener(orders);
      }, setError);
  }, [repo, enabled]);

  const { value } = useLive<Order[]>(subscribe, []);
  return { orders: enabled ? value : [], loading: !repo || !enabled, error };
}

export function useOrder(id: string | null): {
  order: Order | null;
  loading: boolean;
} {
  const repo = useOrderRepo();

  const subscribe = useMemo(
    () =>
      repo && id
        ? (listener: (order: Order | null) => void) =>
            repo.subscribeOrder(id, listener)
        : null,
    [repo, id],
  );

  const { value } = useLive<Order | null>(subscribe, null);
  return { order: value, loading: !repo };
}

export function useSpecialOffer(): SpecialOffer {
  const repo = useConfigRepo();
  const subscribe = useMemo(
    () =>
      repo
        ? (listener: (offer: SpecialOffer) => void) => repo.subscribe(listener)
        : null,
    [repo],
  );
  const { value } = useLive<SpecialOffer>(subscribe, {
    enabled: false,
    text: "",
  });
  return value;
}

/**
 * The cafe's tables: the owner's saved list, or the NEXT_PUBLIC_TABLES default
 * until one is saved.
 *
 * Unlike the hooks above this reports `loading` until the first snapshot has
 * actually arrived, not merely until the repository exists. The customer's
 * table check depends on it: answering with the default while the saved list is
 * still in flight would bounce someone who scanned a perfectly good QR code for
 * table 9 to "that table number looks odd", just because 9 is not in 1..6.
 */
export function useTables(): {
  tables: number[];
  /** The saved list itself, `null` when the default is in use. */
  saved: number[] | null;
  loading: boolean;
} {
  const repo = useConfigRepo();
  // Tagged with the repo it came from, so a snapshot from a previous backend
  // (the demo bundle before Firebase loads) is never mistaken for this one's.
  const [snapshot, setSnapshot] = useState<{
    repo: ConfigRepository;
    saved: number[] | null;
  } | null>(null);

  useEffect(() => {
    if (!repo) return;
    return repo.subscribeTables((saved) => setSnapshot({ repo, saved }));
  }, [repo]);

  const loaded = snapshot !== null && snapshot.repo === repo;
  const saved = loaded ? snapshot.saved : null;
  const fallback = useMemo(() => getTableNumbers(), []);
  return { tables: saved ?? fallback, saved, loading: !loaded };
}

export function useStaffSession(): {
  user: StaffUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPin: (pin: string) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const repo = useAuthRepo();

  const subscribe = useMemo(
    () =>
      repo
        ? (listener: (user: StaffUser | null) => void) =>
            repo.subscribe(listener)
        : null,
    [repo],
  );

  const { value } = useLive<StaffUser | null>(subscribe, null);

  return {
    user: value,
    loading: !repo,
    signIn: useCallback(
      async (email, password) => {
        if (!repo) throw new Error("Storage is not ready yet.");
        await repo.signIn(email, password);
      },
      [repo],
    ),
    signInWithPin: useCallback(
      async (pin) => {
        if (!repo) throw new Error("Storage is not ready yet.");
        await repo.signInWithPin(pin);
      },
      [repo],
    ),
    signOut: useCallback(async () => {
      if (!repo) return;
      await repo.signOut();
    }, [repo]),
  };
}

/** Escape hatch for imperative writes (create order, update status, …). */
export function useActions() {
  const menu = useMenuRepo();
  const orders = useOrderRepo();
  const config = useConfigRepo();

  return useMemo(
    () => ({
      menu,
      orders,
      config,
    }),
    [menu, orders, config],
  );
}
