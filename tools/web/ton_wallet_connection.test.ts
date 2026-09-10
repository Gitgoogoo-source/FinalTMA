import assert from "node:assert/strict";
import test from "node:test";
import { requestWalletConnection } from "../../apps/web/src/domains/wallet/connection.ts";

type Connector = Parameters<typeof requestWalletConnection>[0];
type Wallet = Awaited<ReturnType<typeof requestWalletConnection>>;
function fakeConnector() {
  let status: Parameters<Connector["onStatusChange"]>[0] = () => {};
  let modal: Parameters<Connector["onModalStateChange"]>[0] = () => {};
  let unsubscribed = 0;
  let closed = 0;
  let opened = 0;
  const openingWaiters: Array<() => void> = [];
  const connector: Connector = {
    onStatusChange(callback) {
      status = callback;
      return () => {
        unsubscribed++;
      };
    },
    onModalStateChange(callback) {
      modal = callback;
      return () => {
        unsubscribed++;
      };
    },
    async openModal() {
      opened++;
      openingWaiters.splice(0).forEach((resolve) => resolve());
    },
    closeModal() {
      closed++;
    },
  };
  return {
    connector,
    waitForOpen: async (count: number) => {
      while (opened < count)
        await new Promise<void>((resolve) => openingWaiters.push(resolve));
    },
    status: (wallet: Wallet) => status(wallet),
    cancel: () => modal({ status: "closed", closeReason: "action-cancelled" }),
    selected: () => modal({ status: "closed", closeReason: "wallet-selected" }),
    unsubscribed: () => unsubscribed,
    closed: () => closed,
  };
}
const wallet = {
  account: { address: `0:${"a".repeat(64)}`, chain: "-239" },
} as Wallet;

test("selection waits for the signed response; duplicate events resolve once and release subscriptions", async () => {
  const f = fakeConnector();
  const promise = requestWalletConnection(
    f.connector,
    new AbortController().signal,
    1000,
  );
  f.selected();
  f.status(wallet);
  f.status(wallet);
  assert.equal(await promise, wallet);
  assert.equal(f.unsubscribed(), 2);
  assert.equal(f.closed(), 0);
});

test("cancelling the picker permits a fresh connection", async () => {
  const f = fakeConnector();
  const promise = requestWalletConnection(
    f.connector,
    new AbortController().signal,
    1000,
  );
  f.cancel();
  await assert.rejects(promise, /WALLET_CONNECTION_CANCELLED/);
  assert.equal(f.unsubscribed(), 2);
  const retry = requestWalletConnection(
    f.connector,
    new AbortController().signal,
    1000,
  );
  await f.waitForOpen(2);
  f.status(wallet);
  assert.equal(await retry, wallet);
});

test("closing the game dialog aborts pending connection and ignores a late wallet event", async () => {
  const f = fakeConnector();
  const controller = new AbortController();
  const promise = requestWalletConnection(f.connector, controller.signal, 1000);
  controller.abort();
  f.status(wallet);
  await assert.rejects(promise, /WALLET_CONNECTION_CANCELLED/);
  assert.equal(f.unsubscribed(), 2);
});

test("expired challenges terminate the request", async () => {
  const f = fakeConnector();
  await assert.rejects(
    requestWalletConnection(f.connector, new AbortController().signal, 5),
    /WALLET_CONNECTION_EXPIRED/,
  );
  assert.equal(f.unsubscribed(), 2);
  assert.equal(f.closed(), 1);
});

test("wallet-list network failure is surfaced and releases subscriptions", async () => {
  const f = fakeConnector();
  f.connector.openModal = async () => {
    throw new Error("offline");
  };
  await assert.rejects(
    requestWalletConnection(f.connector, new AbortController().signal, 1000),
    /offline/,
  );
  assert.equal(f.unsubscribed(), 2);
});

for (const reason of ["abort", "timeout"] as const) {
  test(`a delayed picker is closed after ${reason}, before a retry opens`, async () => {
    const f = fakeConnector();
    let release!: () => void;
    const list = new Promise<void>((resolve) => {
      release = resolve;
    });
    let visible = false;
    let opens = 0;
    const originalOpen = f.connector.openModal;
    f.connector.openModal = async () => {
      opens++;
      if (opens === 1) await list;
      visible = true;
      await originalOpen();
    };
    f.connector.closeModal = () => {
      visible = false;
    };
    const controller = new AbortController();
    const first = requestWalletConnection(
      f.connector,
      controller.signal,
      reason === "timeout" ? 5 : 1000,
    );
    if (reason === "abort") controller.abort();
    await assert.rejects(first, /WALLET_CONNECTION_(CANCELLED|EXPIRED)/);
    const retry = requestWalletConnection(
      f.connector,
      new AbortController().signal,
      1000,
    );
    assert.equal(opens, 1, "the retry must not race the obsolete opening");
    release();
    await f.waitForOpen(2);
    assert.equal(visible, true, "obsolete cleanup must not close the retry");
    f.status(wallet);
    assert.equal(await retry, wallet);
    assert.equal(visible, true);
  });
}

test("a delayed picker stays closed when there is no retry", async () => {
  const f = fakeConnector();
  let release!: () => void;
  const list = new Promise<void>((resolve) => {
    release = resolve;
  });
  let visible = false;
  f.connector.openModal = async () => {
    await list;
    visible = true;
  };
  f.connector.closeModal = () => {
    visible = false;
  };
  const controller = new AbortController();
  const pending = requestWalletConnection(f.connector, controller.signal, 1000);
  controller.abort();
  await assert.rejects(pending);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(visible, false);
});

test("a queued retry cancelled before the wallet list returns never opens", async () => {
  const f = fakeConnector();
  let release!: () => void;
  const list = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opens = 0;
  f.connector.openModal = async () => {
    opens++;
    await list;
  };
  const a = new AbortController();
  const first = requestWalletConnection(f.connector, a.signal, 1000);
  a.abort();
  await assert.rejects(first);
  const b = new AbortController();
  const second = requestWalletConnection(f.connector, b.signal, 1000);
  b.abort();
  await assert.rejects(second);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(opens, 1);
});

test("restore consumes the current signed wallet without opening another picker", async () => {
  const f = fakeConnector();
  f.connector.wallet = wallet;
  f.connector.openModal = async () => {
    assert.fail("restore must not open a picker");
  };
  assert.equal(
    await requestWalletConnection(
      f.connector,
      new AbortController().signal,
      1000,
      { restore: true },
    ),
    wallet,
  );
});

test("restore waits for a pending bridge reply arriving after SDK restoration settles", async () => {
  const f = fakeConnector();
  const restored = requestWalletConnection(
    f.connector,
    new AbortController().signal,
    1000,
    { restore: true },
  );
  f.status(wallet);
  assert.equal(await restored, wallet);
});

test("an immediate retry ignores the SDK's delayed close notification", async () => {
  const f = fakeConnector();
  f.connector.closeModal = () => {
    setTimeout(() => f.cancel(), 0);
  };
  const controller = new AbortController();
  const first = requestWalletConnection(f.connector, controller.signal, 1000);
  await f.waitForOpen(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(first);
  const retry = requestWalletConnection(
    f.connector,
    new AbortController().signal,
    1000,
  );
  await f.waitForOpen(2);
  f.status(wallet);
  assert.equal(await retry, wallet);
});
