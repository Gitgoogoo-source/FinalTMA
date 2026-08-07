import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { Button, CatalogImage } from "../../../shared/ui/index.tsx";
import { battleElementLabels, battleRarityLabels } from "../labels.ts";

type TeamOption = RouteOutput<"battle.team_options">["items"][number];
export type BattleTeamSlots = readonly [
  string | null,
  string | null,
  string | null,
];

const pageSize = 9;

export function TeamSelector({
  items,
  slots,
  disabled,
  loading,
  onChange,
}: {
  items: readonly TeamOption[];
  slots: BattleTeamSlots;
  disabled: boolean;
  loading: boolean;
  onChange(slots: BattleTeamSlots): void;
}): ReactNode {
  const [activeSlot, setActiveSlot] = useState<0 | 1 | 2>(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return normalized
      ? items.filter(
          (item) =>
            item.name.toLocaleLowerCase("zh-CN").includes(normalized) ||
            item.template_id.toLocaleLowerCase("en-US").includes(normalized),
        )
      : items;
  }, [items, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize,
  );
  const focused =
    items.find((item) => item.template_id === focusedId) ??
    items.find((item) => item.template_id === slots[activeSlot]) ??
    visible[0] ??
    null;

  const choose = (templateId: string) => {
    const existing = slots.indexOf(templateId);
    const next = [...slots] as [string | null, string | null, string | null];
    if (existing >= 0 && existing !== activeSlot) {
      const replaced = next[activeSlot];
      next[activeSlot] = templateId;
      next[existing] = replaced;
    } else {
      next[activeSlot] = templateId;
    }
    onChange(next);
    setFocusedId(templateId);
    const empty = next.findIndex(
      (value, index) => value === null && index !== activeSlot,
    );
    if (empty === 0 || empty === 1 || empty === 2) setActiveSlot(empty);
  };

  return (
    <div className="battle-team-selector">
      <section className="battle-team-slots" aria-label="Battle 队伍槽位">
        {slots.map((templateId, index) => {
          const item = items.find(
            (candidate) => candidate.template_id === templateId,
          );
          const slotIndex = index as 0 | 1 | 2;
          return (
            <div key={index} className={activeSlot === index ? "active" : ""}>
              <button
                type="button"
                aria-pressed={activeSlot === index}
                disabled={disabled}
                onClick={() => {
                  setActiveSlot(slotIndex);
                  setFocusedId(templateId);
                }}
              >
                <small>{index === 0 ? "首发" : `${index + 1} 号位`}</small>
                {item ? (
                  <>
                    <CatalogImage
                      url={item.image_thumbnail_url}
                      alt=""
                      variant="thumbnail"
                      loading="lazy"
                    />
                    <strong>{item.name}</strong>
                    <span>{battleRarityLabels[item.rarity]}</span>
                  </>
                ) : (
                  <span className="battle-empty-slot">选择藏品</span>
                )}
              </button>
              {item ? (
                <button
                  type="button"
                  aria-label={`移除${item.name}`}
                  disabled={disabled}
                  onClick={() => {
                    const next = [...slots] as [
                      string | null,
                      string | null,
                      string | null,
                    ];
                    next[index] = null;
                    onChange(next);
                  }}
                >
                  <X />
                </button>
              ) : null}
            </div>
          );
        })}
      </section>

      <div className="battle-order-actions" aria-label="调整队伍顺序">
        <Button
          className="secondary"
          disabled={disabled || activeSlot === 0}
          onClick={() => {
            if (activeSlot === 0) return;
            const next = [...slots] as [
              string | null,
              string | null,
              string | null,
            ];
            const previous = activeSlot === 1 ? 0 : 1;
            [next[previous], next[activeSlot]] = [
              next[activeSlot]!,
              next[previous]!,
            ];
            onChange(next);
            setActiveSlot(previous);
          }}
        >
          <ChevronLeft />
          前移
        </Button>
        <span>
          <ArrowLeftRight />
          槽位顺序决定首发与超时换入顺序
        </span>
        <Button
          className="secondary"
          disabled={disabled || activeSlot === 2}
          onClick={() => {
            if (activeSlot === 2) return;
            const next = [...slots] as [
              string | null,
              string | null,
              string | null,
            ];
            const following = activeSlot === 0 ? 1 : 2;
            [next[following], next[activeSlot]] = [
              next[activeSlot]!,
              next[following]!,
            ];
            onChange(next);
            setActiveSlot(following);
          }}
        >
          后移
          <ChevronRight />
        </Button>
      </div>

      <label className="battle-team-search">
        <Search />
        <span className="sr-only">搜索本人可用藏品</span>
        <input
          value={query}
          disabled={disabled}
          placeholder="搜索本人可用藏品"
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </label>

      {loading ? (
        <div className="battle-selector-state">正在读取本人可用藏品</div>
      ) : visible.length === 0 ? (
        <div className="battle-selector-state">没有符合条件的可用藏品</div>
      ) : (
        <div className="battle-option-grid">
          {visible.map((item) => {
            const selectedSlot = slots.indexOf(item.template_id);
            return (
              <button
                key={item.template_id}
                type="button"
                className={selectedSlot >= 0 ? "selected" : ""}
                disabled={disabled || item.available_quantity < 1}
                aria-pressed={selectedSlot >= 0}
                onFocus={() => setFocusedId(item.template_id)}
                onPointerEnter={() => setFocusedId(item.template_id)}
                onClick={() => choose(item.template_id)}
              >
                <CatalogImage
                  url={item.image_thumbnail_url}
                  alt={item.name}
                  variant="thumbnail"
                  loading="lazy"
                />
                <strong>{item.name}</strong>
                <small>
                  {battleRarityLabels[item.rarity]} · {item.stage} 阶 · 可用{" "}
                  {item.available_quantity}
                </small>
                {selectedSlot >= 0 ? (
                  <span>{selectedSlot + 1} 号位</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <div className="battle-pagination" aria-label="藏品分页">
        <Button
          className="secondary"
          disabled={disabled || safePage === 0}
          onClick={() => setPage((value) => Math.max(0, value - 1))}
        >
          <ChevronLeft />
          上一页
        </Button>
        <span>
          {safePage + 1} / {pageCount}
        </span>
        <Button
          className="secondary"
          disabled={disabled || safePage + 1 >= pageCount}
          onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
        >
          下一页
          <ChevronRight />
        </Button>
      </div>

      {focused ? <TeamOptionDetail item={focused} /> : null}
    </div>
  );
}

function TeamOptionDetail({ item }: { item: TeamOption }): ReactNode {
  return (
    <section
      className="battle-option-detail"
      aria-labelledby="battle-option-detail-name"
    >
      <div className="battle-option-detail-art">
        <CatalogImage
          url={item.image_detail_url}
          alt={item.name}
          variant="detail"
          loading="lazy"
        />
      </div>
      <div>
        <small>
          {battleRarityLabels[item.rarity]} · {item.stage} 阶 ·{" "}
          {battleElementLabels[item.element]}
        </small>
        <h3 id="battle-option-detail-name">{item.name}</h3>
        <dl className="battle-stat-grid">
          <div>
            <dt>生命</dt>
            <dd>{item.max_hp}</dd>
          </div>
          <div>
            <dt>攻击</dt>
            <dd>{item.attack}</dd>
          </div>
          <div>
            <dt>防御</dt>
            <dd>{item.defense}</dd>
          </div>
          <div>
            <dt>速度</dt>
            <dd>{item.speed}</dd>
          </div>
        </dl>
        <div className="battle-skill-preview">
          {item.skills.map((skill) => (
            <div key={skill.skill_id}>
              <strong>{skill.name}</strong>
              <span>
                威力 {skill.power} · 命中 {skill.accuracy_bps / 100}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
