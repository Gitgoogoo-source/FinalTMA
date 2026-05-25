import { BookOpen } from "lucide-react";

import type { AlbumItem } from "../album.types";
import { AlbumItemCard } from "./AlbumItemCard";

type AlbumGridProps = {
  items: AlbumItem[];
};

export function AlbumGrid({ items }: AlbumGridProps) {
  if (items.length === 0) {
    return (
      <section className="album-grid" aria-label="图鉴物品">
        <div className="album-grid__empty">
          <BookOpen aria-hidden="true" size={28} strokeWidth={2.1} />
          <strong>暂无图鉴物品</strong>
          <span>当前图鉴册还没有配置可展示的藏品。</span>
        </div>
      </section>
    );
  }

  const collectedCount = items.filter((item) => item.isCollected).length;

  return (
    <section className="album-grid" aria-labelledby="album-grid-title">
      <header className="album-grid__header">
        <div>
          <span>图鉴物品</span>
          <h2 id="album-grid-title">藏品收集</h2>
        </div>
        <strong>
          {collectedCount} / {items.length}
        </strong>
      </header>

      <div className="album-grid__list" role="list">
        {items.map((item) => (
          <AlbumItemCard
            item={item}
            key={`${item.templateId}:${item.formId ?? "template"}`}
          />
        ))}
      </div>
    </section>
  );
}
