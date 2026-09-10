import type { TonConnectUI, Wallet } from "@tonconnect/ui-react";

type Connector = Pick<
  TonConnectUI,
  "onStatusChange" | "onModalStateChange" | "openModal" | "closeModal"
> & { wallet?: Wallet | null };

// An openModal call cannot be aborted by the SDK. Drain and close an obsolete
// opening before a retry subscribes, so its late result cannot affect the retry.
const openings = new WeakMap<Connector, Promise<void>>();

export function requestWalletConnection(
  connector: Connector,
  signal: AbortSignal,
  timeoutMs: number,
  options: { restore?: boolean; beforeOpen?(): void } = {},
): Promise<Wallet> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let cancelled = false;
    let started = false;
    const disposers: Array<() => void> = [];
    const finish = (wallet: Wallet | null, error?: Error) => {
      if (settled) return;
      settled = true;
      cancelled = !wallet;
      disposers.forEach((dispose) => dispose());
      if (wallet) resolve(wallet);
      else {
        if (started && !options.restore) {
          connector.closeModal();
          if (!openings.has(connector)) {
            const closing = new Promise<void>((done) => setTimeout(done, 0));
            openings.set(connector, closing);
            void closing.then(() => {
              if (openings.get(connector) === closing)
                openings.delete(connector);
            });
          }
        }
        reject(error ?? new Error("WALLET_CONNECTION_CANCELLED"));
      }
    };
    const abort = () => finish(null, new Error("WALLET_CONNECTION_CANCELLED"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    disposers.push(() => signal.removeEventListener("abort", abort));
    const timer = setTimeout(
      () => finish(null, new Error("WALLET_CONNECTION_EXPIRED")),
      timeoutMs,
    );
    disposers.push(() => clearTimeout(timer));

    const start = async () => {
      if (settled) return;
      started = true;
      disposers.push(
        connector.onStatusChange(
          (wallet) => {
            if (wallet) finish(wallet);
          },
          (error) => finish(null, error),
        ),
      );
      if (options.restore) {
        if (connector.wallet) finish(connector.wallet);
        return;
      }
      disposers.push(
        connector.onModalStateChange((state) => {
          if (
            state.status === "closed" &&
            state.closeReason !== "wallet-selected"
          )
            abort();
        }),
      );
      try {
        options.beforeOpen?.();
        await connector.openModal();
      } catch (error) {
        finish(null, error instanceof Error ? error : new Error(String(error)));
      } finally {
        if (cancelled) {
          connector.closeModal();
          // SDK modal state notifications are scheduled with setTimeout(0).
          await new Promise<void>((done) => setTimeout(done, 0));
        }
      }
    };
    const previous = openings.get(connector);
    const opening = previous ? previous.then(start) : start();
    openings.set(connector, opening);
    void opening.finally(() => {
      if (openings.get(connector) === opening) openings.delete(connector);
    });
  });
}
