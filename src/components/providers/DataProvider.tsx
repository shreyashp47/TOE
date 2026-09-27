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

import { isDemoMode } from "@/lib/config";
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

  return (
    <DataContext.Provider value={value}>{children}</DataContext.Provider>
  );
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

export function useActiveOrders(): {
  orders: Order[];
  loading: boolean;
  error: Error | null;
} {
  const repo = useOrderRepo();
  const [error, setError] = useState<Error | null>(null);

  const subscribe = useMemo(
    () =>
      repo
        ? (listener: (orders: Order[]) => void) =>
            repo.subscribeActive(listener, setError)
        : null,
    [repo],
  );

  const { value } = useLive<Order[]>(subscribe, []);
  return { orders: value, loading: !repo, error };
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
