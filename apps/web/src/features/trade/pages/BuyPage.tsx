import { MarketBanner } from "../components/MarketBanner";
import { MarketFilters } from "../components/MarketFilters";
import { MarketListingGrid } from "../components/MarketListingGrid";
import { useMarketFilters } from "../hooks/useMarketFilters";
import { useMarketListings } from "../hooks/useMarketListings";

export function BuyPage() {
  const { filters, hasActiveFilters, query, resetFilters, updateFilter } =
    useMarketFilters();
  const { isError, isLoading, listings, refetch } = useMarketListings(query);

  return (
    <section
      aria-labelledby="trade-tab-buy"
      className="trade-panel"
      data-testid="trade-buy-panel"
      id="trade-tab-panel-buy"
      role="tabpanel"
      tabIndex={0}
    >
      <MarketBanner />
      <MarketFilters
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        onFilterChange={updateFilter}
        onReset={resetFilters}
      />
      <MarketListingGrid
        isError={isError}
        isLoading={isLoading}
        listings={listings}
        onRetry={() => {
          void refetch();
        }}
      />
    </section>
  );
}
