import type { RouteOutput } from "@evomypet/api-contracts/app-client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useApiQuery } from "../../platform/query/index.ts";
import { useSession } from "../../platform/session/store.ts";
import {
  subscribeTelegramActivity,
  telegram,
} from "../../platform/telegram/index.ts";

type MarketMineOutput = RouteOutput<"market.my_listings">;
type ApiMarketSoldEvent = MarketMineOutput["sold_events"][number];
export type MarketSoldEvent = Omit<ApiMarketSoldEvent, "image_thumbnail_url">;

type SoldInboxState = {
  userId: string | null;
  cursor: string | null;
  pendingEvents: MarketSoldEvent[];
};

type ListingState = {
  items: MarketMineOutput["listings"];
};

type SoldInboxSnapshot = SoldInboxState & ListingState;

type SoldInboxStore = {
  userId: string | null;
  getSnapshot(): SoldInboxSnapshot;
  subscribe(listener: () => void): () => void;
  apply(response: MarketMineOutput): void;
  dismiss(saleSequence: string): void;
};

const STORAGE_VERSION = 2;
const STORAGE_PREFIX = "evomypet.market.sold-inbox.v2";
const MAX_SEQUENCE = 9_223_372_036_854_775_807n;

export function useMarketSoldInbox(
  queryEnabled: boolean,
  pollingEnabled: boolean,
) {
  const session = useSession();
  const userId = session?.userId ?? null;
  const surfaceActive = useMarketSurfaceActive();
  const store = useMemo(() => createInboxStore(userId), [userId]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const input = useMemo(
    () =>
      snapshot.cursor === null ? {} : { after_sale_sequence: snapshot.cursor },
    [snapshot.cursor],
  );
  const enabled = Boolean(userId) && queryEnabled && surfaceActive;
  const query = useApiQuery("market.my_listings", input, enabled);
  const response = query.data;
  const refetch = query.refetch;
  const hasMore = query.data?.has_more;
  const poll = Boolean(userId) && pollingEnabled && surfaceActive;
  const wasPolling = useRef(false);

  useEffect(() => {
    if (response) store.apply(response);
  }, [response, store]);

  useEffect(() => {
    if (poll && !wasPolling.current) void refetch();
    wasPolling.current = poll;
  }, [poll, refetch]);

  useEffect(() => {
    if (!poll || hasMore) return;
    const timer = window.setInterval(() => void refetch(), 10_000);
    return () => window.clearInterval(timer);
  }, [hasMore, poll, refetch]);

  return {
    query,
    listings: snapshot.items,
    soldEvents: snapshot.pendingEvents,
    dismiss: store.dismiss,
  };
}

function useMarketSurfaceActive(): boolean {
  const [active, setActive] = useState(
    () =>
      document.visibilityState !== "hidden" &&
      telegram()?.isActive !== false &&
      navigator.onLine !== false,
  );
  useEffect(() => {
    let telegramActive = telegram()?.isActive !== false;
    let online = navigator.onLine !== false;
    const publish = () =>
      setActive(
        document.visibilityState !== "hidden" && telegramActive && online,
      );
    const activated = () => {
      telegramActive = true;
      publish();
    };
    const deactivated = () => {
      telegramActive = false;
      publish();
    };
    const connected = () => {
      online = true;
      publish();
    };
    const disconnected = () => {
      online = false;
      publish();
    };
    document.addEventListener("visibilitychange", publish);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    const unsubscribe = subscribeTelegramActivity(activated, deactivated);
    return () => {
      document.removeEventListener("visibilitychange", publish);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
      unsubscribe();
    };
  }, []);
  return active;
}

function initialInbox(userId: string | null): SoldInboxState {
  if (!userId) return { userId: null, cursor: null, pendingEvents: [] };
  return readInbox(userId) ?? { userId, cursor: null, pendingEvents: [] };
}

function createInboxStore(userId: string | null): SoldInboxStore {
  const inbox = initialInbox(userId);
  let snapshot: SoldInboxSnapshot = { ...inbox, items: [] };
  const listeners = new Set<() => void>();
  const publish = (next: SoldInboxSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    userId,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply: (response) => {
      const next = {
        userId,
        cursor: response.sale_cursor,
        pendingEvents: mergeEvents(
          snapshot.pendingEvents,
          response.sold_events.map(withoutImageUrl),
        ),
        items: response.listings,
      };
      persistInbox(next);
      publish(next);
    },
    dismiss: (saleSequence) => {
      const next = {
        ...snapshot,
        pendingEvents: snapshot.pendingEvents.filter(
          (event) => event.sale_sequence !== saleSequence,
        ),
      };
      persistInbox(next);
      publish(next);
    },
  };
}

function readInbox(userId: string): SoldInboxState | null {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    if (
      value.version !== STORAGE_VERSION ||
      value.user_id !== userId ||
      !isSaleSequence(value.cursor) ||
      !Array.isArray(value.pending_events) ||
      !value.pending_events.every(isSoldEvent)
    )
      return null;
    const pendingEvents = mergeEvents([], value.pending_events);
    if (
      pendingEvents.some(
        (event) => BigInt(event.sale_sequence) > BigInt(value.cursor as string),
      )
    )
      return null;
    return { userId, cursor: value.cursor, pendingEvents };
  } catch {
    return null;
  }
}

function persistInbox(state: SoldInboxState): boolean {
  if (!state.userId || state.cursor === null) return false;
  try {
    window.localStorage.setItem(
      storageKey(state.userId),
      JSON.stringify({
        version: STORAGE_VERSION,
        user_id: state.userId,
        cursor: state.cursor,
        pending_events: state.pendingEvents,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function mergeEvents(
  current: readonly MarketSoldEvent[],
  incoming: readonly MarketSoldEvent[],
): MarketSoldEvent[] {
  const events = new Map<string, MarketSoldEvent>();
  for (const event of current) events.set(event.sale_sequence, event);
  for (const event of incoming) events.set(event.sale_sequence, event);
  return [...events.values()].sort((left, right) =>
    BigInt(left.sale_sequence) > BigInt(right.sale_sequence) ? -1 : 1,
  );
}

function withoutImageUrl(event: ApiMarketSoldEvent): MarketSoldEvent {
  return {
    sale_sequence: event.sale_sequence,
    template_id: event.template_id,
    name: event.name,
    rarity: event.rarity,
    stage: event.stage,
    quantity: event.quantity,
    unit_price: event.unit_price,
    sold_at: event.sold_at,
  };
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function isSoldEvent(value: unknown): value is MarketSoldEvent {
  if (!isRecord(value)) return false;
  return (
    isSaleSequence(value.sale_sequence) &&
    typeof value.template_id === "string" &&
    value.template_id.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    ["common", "rare", "epic", "legendary", "mythic"].includes(
      String(value.rarity),
    ) &&
    Number.isInteger(value.stage) &&
    Number(value.stage) >= 1 &&
    Number(value.stage) <= 3 &&
    isPositiveSafeInteger(value.quantity) &&
    isPositiveSafeInteger(value.unit_price) &&
    typeof value.sold_at === "string" &&
    !Number.isNaN(Date.parse(value.sold_at))
  );
}

function isSaleSequence(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d{0,18})$/.test(value) &&
    BigInt(value) <= MAX_SEQUENCE
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
