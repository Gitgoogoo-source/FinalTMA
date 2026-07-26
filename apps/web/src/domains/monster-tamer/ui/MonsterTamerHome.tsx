import type { RouteOutput } from "@pokepets/api-contracts/app";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button, CollectionDetailShowcase } from "../../../shared/ui/index.tsx";

type InventoryItem = RouteOutput<"inventory.list">["items"][number];
type FrameMessage =
  | { source: "pokepets.monster-tamer"; type: "ready" }
  | {
      source: "pokepets.monster-tamer";
      type: "select";
      templateId: string;
    }
  | {
      source: "pokepets.monster-tamer";
      type: "asset-error";
      failed: number;
    }
  | {
      source: "pokepets.monster-tamer";
      type: "runtime-error";
      message: string;
    };

export function MonsterTamerHome(): ReactNode {
  const query = useApiQuery("inventory.list");
  const iframe = useRef<HTMLIFrameElement>(null);
  const [frameRevision, setFrameRevision] = useState(0);
  const [frameReady, setFrameReady] = useState(false);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [failedImages, setFailedImages] = useState(0);
  const items = useMemo(
    () => [
      ...new Map(
        (query.data?.items ?? [])
          .filter((item) => item.available > 0)
          .map((item) => [item.template_id, item]),
      ).values(),
    ],
    [query.data?.items],
  );

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframe.current?.contentWindow ||
        !isFrameMessage(event.data)
      )
        return;
      const message = event.data;
      if (message.type === "ready") setFrameReady(true);
      if (message.type === "asset-error") setFailedImages(message.failed);
      if (message.type === "runtime-error") setRuntimeError(message.message);
      if (message.type === "select") {
        const item = items.find(
          (candidate) => candidate.template_id === message.templateId,
        );
        if (item) setSelected(item);
        else setRuntimeError("藏品状态已经变化，请重新加载家园。");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [items]);

  useEffect(() => {
    if (
      !frameReady ||
      !query.data ||
      query.isFetching ||
      query.error ||
      !iframe.current?.contentWindow
    )
      return;
    iframe.current.contentWindow.postMessage(
      {
        source: "pokepets.monster-home",
        type: "init",
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
        items: items.map((item) => ({
          templateId: item.template_id,
          name: item.name,
          imageThumbnailPath: item.image_thumbnail_path,
        })),
      },
      window.location.origin,
    );
  }, [frameReady, items, query.data, query.error, query.isFetching]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !selected) return;
      event.preventDefault();
      resumeFrame(iframe.current);
      setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  const restartFrame = () => {
    setFrameReady(false);
    setSelected(null);
    setRuntimeError("");
    setFailedImages(0);
    setFrameRevision((current) => current + 1);
    void query.refetch();
  };

  const content = query.error ? (
    <HomeStatus
      title="藏品读取失败"
      detail={(query.error as Error).message}
      action={
        <Button onClick={() => void query.refetch()}>
          <RefreshCw aria-hidden="true" />
          重新加载
        </Button>
      }
    />
  ) : runtimeError ? (
    <HomeStatus
      title="家园暂时无法打开"
      detail={runtimeError}
      action={
        <Button onClick={restartFrame}>
          <RefreshCw aria-hidden="true" />
          重新加载家园
        </Button>
      }
    />
  ) : null;

  return (
    <section className="monster-home-surface" aria-label="水上家园">
      <iframe
        key={frameRevision}
        ref={iframe}
        className="monster-home-frame"
        src="/monster-tamer/?embedded=1"
        title="Monster Tamer 藏品展示家园地图"
        sandbox="allow-scripts allow-same-origin"
      />
      {content}
      {!content && query.data && !query.isFetching && items.length === 0 ? (
        <p className="monster-home-empty" role="status">
          当前没有可展示的藏品
        </p>
      ) : null}
      {!content && failedImages > 0 ? (
        <p className="monster-home-warning" role="status">
          {failedImages} 张藏品图片加载失败，已暂不显示
        </p>
      ) : null}
      {selected ? (
        <div
          className="monster-home-detail-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            resumeFrame(iframe.current);
            setSelected(null);
          }}
        >
          <div
            className="monster-home-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="monster-home-detail-name"
          >
            <button
              className="monster-home-detail-close"
              type="button"
              aria-label="关闭藏品详情"
              autoFocus
              onClick={() => {
                resumeFrame(iframe.current);
                setSelected(null);
              }}
            >
              <X aria-hidden="true" />
            </button>
            <CollectionDetailShowcase
              item={selected}
              headingId="monster-home-detail-name"
              className="monster-home-detail-showcase"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HomeStatus({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <section className="monster-home-status" aria-live="polite">
      <AlertCircle aria-hidden="true" />
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </section>
  );
}

function resumeFrame(frame: HTMLIFrameElement | null): void {
  frame?.contentWindow?.postMessage(
    { source: "pokepets.monster-home", type: "resume" },
    window.location.origin,
  );
}

function isFrameMessage(value: unknown): value is FrameMessage {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (data.source !== "pokepets.monster-tamer") return false;
  if (data.type === "ready") return true;
  if (
    data.type === "select" &&
    typeof data.templateId === "string" &&
    data.templateId.length > 0
  )
    return true;
  if (
    data.type === "asset-error" &&
    Number.isInteger(data.failed) &&
    Number(data.failed) >= 0
  )
    return true;
  return data.type === "runtime-error" && typeof data.message === "string";
}
