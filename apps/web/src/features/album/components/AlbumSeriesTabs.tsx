import { BookOpen, Layers, Sparkles } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";

import type { AlbumBook } from "../album.types";

type AlbumSeriesTabsProps = {
  books: AlbumBook[];
  selectedBookId: string | null;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSelectBook: (bookId: string | null) => void;
};

const BOOK_TYPE_ORDER = ["all", "series", "rarity"] as const;

export function AlbumSeriesTabs({
  books,
  selectedBookId,
  isLoading = false,
  isError = false,
  error,
  onRetry,
  onSelectBook,
}: AlbumSeriesTabsProps) {
  if (isLoading && books.length === 0) {
    return (
      <section className="album-tabs" aria-busy="true" aria-label="图鉴册">
        <div className="album-tabs__state">
          <span className="album-tabs__spinner" />
          <strong>图鉴册加载中</strong>
        </div>
      </section>
    );
  }

  if (isError && books.length === 0) {
    return (
      <section className="album-tabs" aria-label="图鉴册">
        <div className="album-tabs__state" role="alert">
          <strong>图鉴册读取失败</strong>
          <span>{getApiErrorMessage(error)}</span>
          {onRetry ? (
            <button onClick={onRetry} type="button">
              重试
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (books.length === 0) {
    return (
      <section className="album-tabs" aria-label="图鉴册">
        <div className="album-tabs__state">
          <BookOpen aria-hidden="true" size={22} strokeWidth={2.2} />
          <strong>暂无图鉴册</strong>
        </div>
      </section>
    );
  }

  return (
    <section className="album-tabs" aria-label="图鉴册">
      {BOOK_TYPE_ORDER.map((bookType) => {
        const groupedBooks = books.filter((book) => book.bookType === bookType);

        if (groupedBooks.length === 0) {
          return null;
        }

        return (
          <div className="album-tabs__group" key={bookType}>
            <div className="album-tabs__group-title">
              {getBookTypeIcon(bookType)}
              <span>{getBookTypeLabel(bookType)}</span>
            </div>
            <div className="album-tabs__list" role="list">
              {groupedBooks.map((book) => {
                const active = isBookSelected(book, selectedBookId);
                const completionPercent = clampPercent(book.completionPercent);

                return (
                  <button
                    aria-current={active ? "true" : undefined}
                    className="album-tabs__tab"
                    data-active={active ? "true" : "false"}
                    key={book.bookId}
                    onClick={() => onSelectBook(book.bookId)}
                    type="button"
                  >
                    <span>{book.name}</span>
                    <strong>{formatPercent(completionPercent)}</strong>
                    <em>
                      {book.collectedCount} / {book.totalCount}
                    </em>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function isBookSelected(
  book: AlbumBook,
  selectedBookId: string | null,
): boolean {
  if (selectedBookId) {
    return book.bookId === selectedBookId;
  }

  return book.bookType === "all";
}

function getBookTypeIcon(bookType: string) {
  if (bookType === "series") {
    return <Layers aria-hidden="true" size={15} strokeWidth={2.3} />;
  }

  if (bookType === "rarity") {
    return <Sparkles aria-hidden="true" size={15} strokeWidth={2.3} />;
  }

  return <BookOpen aria-hidden="true" size={15} strokeWidth={2.3} />;
}

function getBookTypeLabel(bookType: string): string {
  if (bookType === "series") {
    return "按系列";
  }

  if (bookType === "rarity") {
    return "按稀有度";
  }

  return "全系列";
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
