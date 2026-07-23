import {
  AlertTriangle,
  Boxes,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  Sprout,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { ApiFailure } from "../../../platform/api/client.ts";
import { useApiQuery } from "../../../platform/query/index.ts";
import { useTelegramBackButton } from "../../../platform/telegram/index.ts";
import { Button } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import type {
  MonsterBattleInput,
  MonsterCheckpointCommand,
  MonsterRegionId,
  MonsterTamerBootstrap,
} from "../types.ts";
import { MonsterTamerCamp } from "./MonsterTamerCamp.tsx";
import {
  MonsterTamerHud,
  type MonsterTamerPanelName,
} from "./MonsterTamerHud.tsx";
import { MonsterTamerWorldViewport } from "./MonsterTamerWorldViewport.tsx";

type OperationKind = "checkpoint" | "battle" | "refresh" | null;

export function MonsterTamerOverlay({
  onClose,
}: {
  onClose(): void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const pendingRevealedCells = useRef(new Map<MonsterRegionId, Set<string>>());
  const pendingTraversedCells = useRef(new Map<MonsterRegionId, string[]>());
  const activeOperation = useRef<OperationKind>(null);
  const currentSnapshot = useRef<MonsterTamerBootstrap | null>(null);
  const statusTimer = useRef<number | null>(null);
  const mounted = useRef(true);
  const query = useApiQuery("monster_tamer.bootstrap");
  const operationRegistry = useOperationRegistry();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<MonsterTamerBootstrap | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [panel, setPanel] = useState<MonsterTamerPanelName | null>(null);
  const [operation, setOperation] = useState<OperationKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const refetchBootstrap = query.refetch;
  const close = useCallback(() => onClose(), [onClose]);
  const changeOperation = useCallback((next: OperationKind) => {
    activeOperation.current = next;
    setOperation(next);
  }, []);
  const acceptSnapshot = useCallback((next: MonsterTamerBootstrap) => {
    const availableIds = new Set(
      next.inventory.map((item) => item.template_id),
    );
    for (const [regionId, pending] of pendingRevealedCells.current) {
      for (const cellId of next.progress.revealed_cells[regionId] ?? [])
        pending.delete(cellId);
      if (pending.size === 0) pendingRevealedCells.current.delete(regionId);
    }
    currentSnapshot.current = next;
    setSnapshot(next);
    if (next.active_battle) setPanel(null);
    setSelection(
      next.progress.party
        .map((member) => member.template_id)
        .filter((templateId) => availableIds.has(templateId))
        .slice(0, 3),
    );
  }, []);

  useTelegramBackButton(true, close);

  useEffect(() => {
    mounted.current = true;
    const current = dialog.current;
    if (current && !current.open) current.showModal();
    return () => {
      mounted.current = false;
      if (statusTimer.current !== null)
        window.clearTimeout(statusTimer.current);
      if (current?.open) current.close();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void refetchBootstrap().then((result) => {
      if (!active) return;
      if (result.data) acceptSnapshot(result.data);
      setInitializing(false);
    });
    return () => {
      active = false;
    };
  }, [acceptSnapshot, refetchBootstrap]);

  const showStatus = useCallback((message: string) => {
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    setSaveMessage(message);
    statusTimer.current = window.setTimeout(() => {
      setSaveMessage(null);
      statusTimer.current = null;
    }, 2_400);
  }, []);

  const refresh = useCallback(async () => {
    changeOperation("refresh");
    try {
      const result = await refetchBootstrap();
      if (!result.data) throw result.error ?? new Error("游戏状态读取失败");
      acceptSnapshot(result.data);
      setError(null);
      return result.data;
    } catch (cause) {
      setError(failureMessage(cause, "游戏状态读取失败，请重试。"));
      return null;
    } finally {
      changeOperation(null);
    }
  }, [acceptSnapshot, changeOperation, refetchBootstrap]);

  const refetchCanonicalSnapshot = useCallback(async () => {
    const delays = [0, 1_000, 2_000, 3_000, 5_000] as const;
    let attempt = 0;
    while (mounted.current) {
      const delay = delays[Math.min(attempt, delays.length - 1)] ?? 5_000;
      attempt += 1;
      if (delay > 0)
        await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
      if (!mounted.current) return null;
      const result = await refetchBootstrap();
      if (!mounted.current) return null;
      if (!result.data) continue;
      acceptSnapshot(result.data);
      return result.data;
    }
    return null;
  }, [acceptSnapshot, refetchBootstrap]);

  const checkpoint = useCallback(
    async (
      command: MonsterCheckpointCommand,
      revealedCellIds: readonly string[] = [],
      traversedCellIds: readonly string[] = [],
      commandId?: string,
    ): Promise<MonsterTamerBootstrap | null> => {
      const current = currentSnapshot.current;
      if (
        !current ||
        activeOperation.current ||
        operationRegistry.isBlocked("monster_tamer.checkpoint")
      )
        return null;
      const regionId = current.progress.current_region;
      const sync = command.type === "sync_revealed_cells";
      const submittedRevealedCellIds = sync
        ? [...revealedCellIds].slice(0, 256)
        : [];
      const submittedTraversedCellIds = sync
        ? [...traversedCellIds].slice(0, 256)
        : [];
      if (
        sync &&
        submittedRevealedCellIds.length === 0 &&
        submittedTraversedCellIds.length === 0
      )
        return current;
      changeOperation("checkpoint");
      setError(null);
      showStatus("正在保存探索进度");
      try {
        const result = await operationRegistry.run(
          "正在保存探索进度",
          "monster_tamer.checkpoint",
          {
            expected_progress_version: current.progress.state_version,
            command,
            ...(submittedRevealedCellIds.length > 0
              ? { revealed_cell_ids: submittedRevealedCellIds }
              : {}),
            ...(submittedTraversedCellIds.length > 0
              ? { traversed_cell_ids: submittedTraversedCellIds }
              : {}),
          },
          {
            dialog: false,
            ...(commandId ? { idempotencyKey: commandId } : {}),
            waitForRecovery: true,
          },
        );
        showStatus(
          result
            ? "服务器已确认，正在同步游戏状态"
            : "操作未生效，正在回正游戏状态",
        );
        const next = await refetchCanonicalSnapshot();
        const pending = pendingRevealedCells.current.get(regionId);
        const traversed = pendingTraversedCells.current.get(regionId);
        if (result) {
          for (const cellId of submittedRevealedCellIds)
            pending?.delete(cellId);
          if (
            traversed &&
            submittedTraversedCellIds.every(
              (cellId, index) => traversed[index] === cellId,
            )
          )
            pendingTraversedCells.current.set(
              regionId,
              traversed.slice(submittedTraversedCellIds.length),
            );
          if (pending?.size === 0)
            pendingRevealedCells.current.delete(regionId);
          if (pendingTraversedCells.current.get(regionId)?.length === 0)
            pendingTraversedCells.current.delete(regionId);
        }
        if (!result) {
          setError("探索操作未完成，已按服务端状态回正。");
          showStatus("探索进度未改变");
          return null;
        }
        if (!next) {
          setError("服务器已完成操作，但最新游戏状态尚未读取。");
          return null;
        }
        setError(null);
        showStatus("探索进度已保存");
        return next;
      } catch (cause) {
        const message = failureMessage(cause, "进度保存失败，请重试。");
        setError(message);
        showStatus("进度尚未保存");
        return null;
      } finally {
        changeOperation(null);
      }
    },
    [changeOperation, operationRegistry, refetchCanonicalSnapshot, showStatus],
  );

  const battle = useCallback(
    async (
      intent:
        | {
            command: "start";
            encounter_id: string;
            source_node_id: string | null;
          }
        | { command: "use_skill"; skill_slot: 1 | 2 | 3 }
        | { command: "acknowledge" },
      commandId?: string,
    ): Promise<MonsterTamerBootstrap | null> => {
      const current = currentSnapshot.current;
      if (
        !current ||
        activeOperation.current ||
        operationRegistry.isBlocked("monster_tamer.battle")
      )
        return null;
      let input: MonsterBattleInput;
      if (intent.command === "start") {
        input = {
          command: "start",
          encounter_id: intent.encounter_id,
          source_node_id: intent.source_node_id,
          expected_progress_version: current.progress.state_version,
        };
      } else if (intent.command === "use_skill") {
        const active = current.active_battle;
        if (
          !active ||
          active.status !== "active" ||
          active.active_template_id === null
        )
          return null;
        input = {
          command: "use_skill",
          battle_id: active.battle_id,
          expected_battle_version: active.state_version,
          actor_template_id: active.active_template_id,
          skill_slot: intent.skill_slot,
        };
      } else {
        const terminal = current.active_battle;
        if (!terminal || terminal.status === "active") return null;
        input = {
          command: "acknowledge",
          battle_id: terminal.battle_id,
          expected_battle_version: terminal.state_version,
        };
      }
      changeOperation("battle");
      setError(null);
      try {
        const result = await operationRegistry.run(
          "正在裁决战斗回合",
          "monster_tamer.battle",
          input,
          {
            dialog: false,
            ...(commandId ? { idempotencyKey: commandId } : {}),
            waitForRecovery: true,
          },
        );
        const next = await refetchCanonicalSnapshot();
        if (!result) {
          setError("战斗操作未完成，已按服务端状态回正。");
          return null;
        }
        if (!next) {
          setError("服务器已完成战斗操作，但最新游戏状态尚未读取。");
          return null;
        }
        setError(null);
        return next;
      } catch (cause) {
        setError(failureMessage(cause, "战斗状态确认失败，正在回正。"));
        return null;
      } finally {
        changeOperation(null);
      }
    },
    [changeOperation, operationRegistry, refetchCanonicalSnapshot],
  );

  const enterRegion = useCallback(
    (regionId: MonsterRegionId) =>
      void checkpoint({
        type: "enter_region",
        region_id: regionId,
        source_node_id: null,
      }),
    [checkpoint],
  );
  const checkpointAfterTraversal = useCallback(
    async (command: MonsterCheckpointCommand) => {
      const current = currentSnapshot.current;
      if (!current) return null;
      const regionId = current.progress.current_region;
      while (true) {
        const revealed = [
          ...(pendingRevealedCells.current.get(regionId) ?? []),
        ].slice(0, 256);
        const traversed = [
          ...(pendingTraversedCells.current.get(regionId) ?? []),
        ].slice(0, 256);
        if (revealed.length === 0 && traversed.length === 0) break;
        if (
          !(await checkpoint(
            { type: "sync_revealed_cells" },
            revealed,
            traversed,
          ))
        )
          return null;
      }
      return checkpoint(command);
    },
    [checkpoint],
  );
  const navigateAway = useCallback(
    (path: string) => {
      onClose();
      navigate(path);
    },
    [navigate, onClose],
  );
  const loading = initializing || (query.isPending && !snapshot);
  const unavailable =
    !snapshot?.active_battle &&
    (snapshot?.entry_state === "no_available_collections" ||
      snapshot?.inventory.length === 0);
  const atCamp =
    !snapshot?.active_battle &&
    (snapshot?.progress.current_region === "camp" ||
      snapshot?.entry_state === "team_reselection_required");

  return (
    <dialog
      ref={dialog}
      className="monster-tamer-overlay"
      aria-labelledby="monster-tamer-overlay-title"
      aria-describedby="monster-tamer-overlay-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h1 id="monster-tamer-overlay-title" className="monster-tamer-sr-only">
        Monster Tamer
      </h1>
      <p
        id="monster-tamer-overlay-description"
        className="monster-tamer-sr-only"
      >
        使用当前 TMA 可用藏品进行生态探索和回合制战斗。
      </p>

      {loading ? (
        <OverlayState
          icon={<LoaderCircle className="spin" />}
          eyebrow="SYNCING COLLECTIONS"
          title="正在读取真实藏品"
          copy="队伍和地图进度确认前不会加载游戏世界。"
          onClose={close}
        />
      ) : query.error && !snapshot ? (
        <OverlayState
          icon={<AlertTriangle />}
          eyebrow="LOAD FAILED"
          title="游戏数据读取失败"
          copy={failureMessage(query.error, "请检查网络后重新读取。")}
          onClose={close}
          action={
            <Button disabled={query.isFetching} onClick={() => void refresh()}>
              <RefreshCw aria-hidden="true" />
              {query.isFetching ? "正在重试" : "重新读取"}
            </Button>
          }
        />
      ) : unavailable ? (
        <OverlayState
          icon={<Sprout />}
          eyebrow="TEAM REQUIRED"
          title="暂无可出战藏品"
          copy="Monster Tamer 只读取当前 available_quantity 大于 0 的真实 TMA 藏品。"
          onClose={close}
          action={
            <div className="monster-tamer-empty-actions">
              <Button onClick={() => navigateAway("/inventory")}>
                <PackageSearch aria-hidden="true" />
                返回藏品页
              </Button>
              <Button className="secondary" onClick={() => navigateAway("/")}>
                <Boxes aria-hidden="true" />
                前往盲盒页
              </Button>
            </div>
          }
        />
      ) : snapshot && atCamp ? (
        <div className="monster-tamer-world-screen monster-tamer-camp-world-screen">
          <MonsterTamerWorldViewport
            snapshot={snapshot}
            paused
            onClose={close}
            onOpenPanel={() => undefined}
            onRevealedCellsChange={(regionId, cellIds) => {
              pendingRevealedCells.current.set(regionId, new Set(cellIds));
            }}
            onTraversedCellsChange={(regionId, cellIds) => {
              pendingTraversedCells.current.set(regionId, [...cellIds]);
            }}
            onCheckpoint={checkpoint}
            onBattle={battle}
          />
          <div className="monster-tamer-preparation-screen">
            <button
              type="button"
              className="monster-tamer-preparation-close"
              aria-label="关闭 Monster Tamer"
              onClick={close}
            >
              <X aria-hidden="true" />
            </button>
            {error ? (
              <div className="monster-tamer-global-alert" role="alert">
                <AlertTriangle aria-hidden="true" />
                <span>{error}</span>
                <button
                  type="button"
                  disabled={operation !== null}
                  onClick={() => void refresh()}
                >
                  重新读取
                </button>
              </div>
            ) : null}
            <MonsterTamerCamp
              snapshot={snapshot}
              selection={selection}
              busy={operation !== null}
              onToggle={(templateId) =>
                setSelection((current) =>
                  current.includes(templateId)
                    ? current.filter((candidate) => candidate !== templateId)
                    : current.length < 3
                      ? [...current, templateId]
                      : current,
                )
              }
              onConfirm={() => {
                if (selection.length === 0) return;
                void checkpoint({
                  type: "confirm_team",
                  template_ids: selection,
                });
              }}
              onEnterRegion={enterRegion}
            />
          </div>
        </div>
      ) : snapshot ? (
        <div className="monster-tamer-world-screen">
          <MonsterTamerWorldViewport
            snapshot={snapshot}
            paused={panel !== null || operation !== null}
            onClose={close}
            onOpenPanel={(nextPanel) =>
              setPanel(nextPanel === "team" ? "backpack" : nextPanel)
            }
            onRevealedCellsChange={(regionId, cellIds) => {
              pendingRevealedCells.current.set(regionId, new Set(cellIds));
            }}
            onTraversedCellsChange={(regionId, cellIds) => {
              pendingTraversedCells.current.set(regionId, [...cellIds]);
            }}
            onCheckpoint={checkpoint}
            onBattle={battle}
          />
          <MonsterTamerHud
            snapshot={snapshot}
            panel={panel}
            busy={operation !== null}
            saveMessage={saveMessage}
            onPanelChange={setPanel}
            onClose={close}
            onUseSkill={(slot) =>
              void battle({ command: "use_skill", skill_slot: slot })
            }
            onUseSupply={(templateId) =>
              void checkpointAfterTraversal({
                type: "use_supply",
                target_template_id: templateId,
              })
            }
            onContinueAfterBattle={() =>
              void battle({ command: "acknowledge" })
            }
          />
          {error ? (
            <div className="monster-tamer-global-alert world" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>{error}</span>
              <button
                type="button"
                disabled={operation !== null}
                onClick={() => void refresh()}
              >
                回正状态
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

function OverlayState({
  icon,
  eyebrow,
  title,
  copy,
  action,
  onClose,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  copy: string;
  action?: ReactNode;
  onClose(): void;
}): ReactNode {
  return (
    <main className="monster-tamer-overlay-state">
      <button
        type="button"
        className="monster-tamer-state-close"
        aria-label="关闭 Monster Tamer"
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </button>
      <div className="monster-tamer-state-mark" aria-hidden="true">
        {icon}
      </div>
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      {action}
    </main>
  );
}

function failureMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiFailure || cause instanceof Error)
    return cause.message || fallback;
  return fallback;
}
