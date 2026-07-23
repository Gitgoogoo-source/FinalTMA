import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type {
  MonsterTamerGameEvent,
  MonsterTamerGameHandle,
  MonsterTamerPanel,
} from "../game/bridge.ts";
import type {
  MonsterBattleInput,
  MonsterCheckpointCommand,
  MonsterRegionId,
  MonsterTamerBootstrap,
} from "../types.ts";

type BattleIntent =
  | Pick<
      Extract<MonsterBattleInput, { command: "start" }>,
      "command" | "encounter_id" | "source_node_id"
    >
  | {
      command: "use_skill";
      skill_slot: 1 | 2 | 3;
    };

export function MonsterTamerWorldViewport({
  snapshot,
  paused,
  onClose,
  onOpenPanel,
  onRevealedCellsChange,
  onTraversedCellsChange,
  onCheckpoint,
  onBattle,
}: {
  snapshot: MonsterTamerBootstrap;
  paused: boolean;
  onClose(): void;
  onOpenPanel(panel: MonsterTamerPanel): void;
  onRevealedCellsChange(
    regionId: MonsterRegionId,
    cellIds: readonly string[],
  ): void;
  onTraversedCellsChange(
    regionId: MonsterRegionId,
    cellIds: readonly string[],
  ): void;
  onCheckpoint(
    command: MonsterCheckpointCommand,
    revealedCellIds?: readonly string[],
    traversedCellIds?: readonly string[],
    commandId?: string,
  ): Promise<MonsterTamerBootstrap | null>;
  onBattle(
    intent: BattleIntent,
    commandId?: string,
  ): Promise<MonsterTamerBootstrap | null>;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<MonsterTamerGameHandle | null>(null);
  const runtimeReady = useRef(false);
  const snapshotRef = useRef(snapshot);
  const pausedRef = useRef(paused);
  const callbacks = useRef({
    onClose,
    onOpenPanel,
    onRevealedCellsChange,
    onTraversedCellsChange,
    onCheckpoint,
    onBattle,
  });
  const [attempt, setAttempt] = useState(0);
  const [runtimeState, setRuntimeState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
    pausedRef.current = paused;
    callbacks.current = {
      onClose,
      onOpenPanel,
      onRevealedCellsChange,
      onTraversedCellsChange,
      onCheckpoint,
      onBattle,
    };
  });

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let active = true;
    let noticeTimer: number | null = null;

    void import("../game/index.ts")
      .then(({ mountMonsterTamer }) => {
        if (!active) return;
        const handle = mountMonsterTamer({
          container,
          snapshot: snapshotRef.current,
          onEvent: (event: MonsterTamerGameEvent) => {
            if (active) void handleGameEvent(event);
          },
        });
        if (!active) {
          handle.destroy();
          return;
        }
        game.current = handle;
        if (runtimeReady.current)
          window.requestAnimationFrame(() => {
            if (active) handle.setPaused(pausedRef.current);
          });
      })
      .catch(() => {
        if (active) setRuntimeState("error");
      });

    return () => {
      active = false;
      if (noticeTimer !== null) window.clearTimeout(noticeTimer);
      game.current?.destroy();
      game.current = null;
      runtimeReady.current = false;
      container.replaceChildren();
    };

    async function handleGameEvent(
      event: MonsterTamerGameEvent,
    ): Promise<void> {
      if (event.type === "ready") {
        runtimeReady.current = true;
        setRuntimeState("ready");
        window.requestAnimationFrame(() => {
          if (active) game.current?.setPaused(pausedRef.current);
        });
        return;
      }
      if (event.type === "close") {
        callbacks.current.onClose();
        return;
      }
      if (event.type === "open-panel") {
        callbacks.current.onOpenPanel(event.panel);
        return;
      }
      if (event.type === "view-state") {
        const canonical = new Set(
          snapshotRef.current.progress.revealed_cells[event.state.areaId] ?? [],
        );
        callbacks.current.onRevealedCellsChange(
          event.state.areaId,
          event.state.revealedCellIds.filter(
            (cellId) => !canonical.has(cellId),
          ),
        );
        callbacks.current.onTraversedCellsChange(
          event.state.areaId,
          event.state.traversedCellIds,
        );
        if (!event.state.notice) return;
        if (noticeTimer !== null) window.clearTimeout(noticeTimer);
        setNotice(event.state.notice);
        noticeTimer = window.setTimeout(() => {
          if (active) setNotice(null);
          noticeTimer = null;
        }, 2_400);
        return;
      }
      if (event.type === "checkpoint") {
        const next = await callbacks.current.onCheckpoint(
          event.command,
          event.revealedCellIds,
          event.traversedCellIds,
          event.commandId,
        );
        game.current?.resolveCommand(
          event.commandId,
          next
            ? { ok: true, snapshot: next }
            : { ok: false, message: "探索进度未确认，请重试。" },
        );
        return;
      }
      if (event.type === "battle") {
        const intent: BattleIntent =
          event.command.kind === "start"
            ? {
                command: "start",
                encounter_id: event.command.encounterId,
                source_node_id: event.command.sourceNodeId,
              }
            : {
                command: "use_skill",
                skill_slot: event.command.skillSlot,
              };
        const next = await callbacks.current.onBattle(intent, event.commandId);
        game.current?.resolveCommand(
          event.commandId,
          next
            ? { ok: true, snapshot: next }
            : { ok: false, message: "战斗状态未确认，请重试。" },
        );
      }
    }
  }, [attempt]);

  useEffect(() => {
    game.current?.replaceSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (!runtimeReady.current) return;
    const frame = window.requestAnimationFrame(() => {
      game.current?.setPaused(paused);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [paused]);

  return (
    <div className="monster-tamer-world-viewport">
      <div ref={host} className="monster-tamer-game-host" />
      {notice ? (
        <div className="monster-tamer-game-notice" role="status">
          {notice}
        </div>
      ) : null}
      {runtimeState !== "ready" ? (
        <div
          className="monster-tamer-runtime-state"
          role={runtimeState === "error" ? "alert" : "status"}
        >
          {runtimeState === "loading" ? (
            <>
              <LoaderCircle className="spin" aria-hidden="true" />
              <span>正在生成生态区域</span>
            </>
          ) : (
            <>
              <AlertTriangle aria-hidden="true" />
              <strong>游戏世界加载失败</strong>
              <button
                type="button"
                onClick={() => {
                  setRuntimeState("loading");
                  setAttempt((value) => value + 1);
                }}
              >
                <RefreshCw aria-hidden="true" />
                重新加载
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
