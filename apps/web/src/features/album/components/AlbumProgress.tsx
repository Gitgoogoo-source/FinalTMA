import { BookOpen, Layers, Sparkles } from "lucide-react";

import type {
  AlbumBook,
  AlbumProgress as AlbumProgressData,
  AlbumRaritySummaryItem,
  AlbumSeriesSummaryItem,
} from "../album.types";

const RARITY_LABELS: Record<string, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

type AlbumProgressProps = {
  progress: AlbumProgressData;
};

export function AlbumProgress({ progress }: AlbumProgressProps) {
  if (progress.empty || !progress.book || progress.book.totalCount <= 0) {
    return (
      <div className="album-empty-state">
        <BookOpen aria-hidden="true" size={34} strokeWidth={2.1} />
        <strong>图鉴配置生成中</strong>
        <span>当前没有可展示的图鉴册，稍后刷新后再查看。</span>
      </div>
    );
  }

  const book = progress.book;
  const completionPercent = getCompletionPercent(book);

  return (
    <section className="album-progress" aria-labelledby="album-progress-title">
      <header className="album-progress__header">
        <div>
          <span>总图鉴</span>
          <h2 id="album-progress-title">{book.name}</h2>
        </div>
        <strong>{formatPercent(completionPercent)}</strong>
      </header>

      <div className="album-progress__meter" aria-hidden="true">
        <span style={{ width: `${completionPercent}%` }} />
      </div>

      <div className="album-progress__stats" aria-label="图鉴收集进度">
        <span>
          <small>已收集</small>
          <strong>{book.collectedCount}</strong>
        </span>
        <span>
          <small>总数量</small>
          <strong>{book.totalCount}</strong>
        </span>
        <span>
          <small>完成度</small>
          <strong>{formatPercent(completionPercent)}</strong>
        </span>
      </div>

      <SummarySection
        title="系列完成情况"
        icon={<Layers aria-hidden="true" size={16} strokeWidth={2.3} />}
        items={progress.seriesSummary}
        getKey={(item) => item.seriesId ?? item.seriesName}
        getLabel={(item) => item.seriesName}
      />

      <SummarySection
        title="稀有度完成情况"
        icon={<Sparkles aria-hidden="true" size={16} strokeWidth={2.3} />}
        items={progress.raritySummary}
        getKey={(item) => item.rarity}
        getLabel={(item) => formatRarity(item.rarity)}
      />
    </section>
  );
}

type SummaryItem = AlbumRaritySummaryItem | AlbumSeriesSummaryItem;

type SummarySectionProps<TItem extends SummaryItem> = {
  title: string;
  icon: React.ReactNode;
  items: TItem[];
  getKey: (item: TItem) => string;
  getLabel: (item: TItem) => string;
};

function SummarySection<TItem extends SummaryItem>({
  title,
  icon,
  items,
  getKey,
  getLabel,
}: SummarySectionProps<TItem>) {
  if (items.length === 0) {
    return (
      <section className="album-summary" aria-label={title}>
        <h3>
          {icon}
          {title}
        </h3>
        <p className="album-summary__empty">暂无汇总数据</p>
      </section>
    );
  }

  return (
    <section className="album-summary" aria-label={title}>
      <h3>
        {icon}
        {title}
      </h3>
      <div className="album-summary__list">
        {items.map((item) => {
          const percent = calculateCompletionPercent(
            item.collectedCount,
            item.totalCount,
          );

          return (
            <div className="album-summary__row" key={getKey(item)}>
              <div className="album-summary__label">
                <strong>{getLabel(item)}</strong>
                <span>
                  {item.collectedCount} / {item.totalCount}
                </span>
              </div>
              <div className="album-summary__meter" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
              <em>{formatPercent(percent)}</em>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function getCompletionPercent(book: AlbumBook): number {
  return calculateCompletionPercent(book.collectedCount, book.totalCount);
}

function calculateCompletionPercent(
  collectedCount: number,
  totalCount: number,
): number {
  if (totalCount <= 0) {
    return 0;
  }

  return clampPercent(Math.round((collectedCount / totalCount) * 10000) / 100);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function formatPercent(value: number): string {
  return `${clampPercent(value).toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

function formatRarity(value: string): string {
  const normalized = value.toLowerCase();
  return RARITY_LABELS[normalized] ?? normalized.toUpperCase();
}
