import { useCallback } from "react";

import { ListingStatsPanel } from "../components/ListingStatsPanel";
import { MyListingFilters } from "../components/MyListingFilters";
import { MyListingsList } from "../components/MyListingsList";
import { useMyListingFilters } from "../hooks/useMyListingFilters";
import { useMyListingStats, useMyListings } from "../hooks/useMyListings";
import type { MyListing } from "../trade.types";

export function ManageListingsPage() {
  const { filters, hasActiveFilters, query, resetFilters, updateFilter } =
    useMyListingFilters();
  const statsQuery = useMyListingStats();
  const listingsQuery = useMyListings(query);
  const handleChangePrice = useCallback((listing: MyListing) => {
    void listing;
  }, []);
  const handleCancel = useCallback((listing: MyListing) => {
    void listing;
  }, []);

  return (
    <section
      aria-labelledby="trade-tab-manage"
      className="trade-panel"
      data-testid="trade-manage-panel"
      id="trade-tab-panel-manage"
      role="tabpanel"
      tabIndex={0}
    >
      <div className="manage-listings-page">
        <ListingStatsPanel
          isError={statsQuery.isError}
          isFetching={statsQuery.isFetching}
          isLoading={statsQuery.isLoading}
          onRetry={() => {
            void statsQuery.refetch();
          }}
          stats={statsQuery.stats}
        />
        <MyListingFilters
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          onFilterChange={updateFilter}
          onReset={resetFilters}
        />
        <MyListingsList
          hasActiveFilters={hasActiveFilters}
          isError={listingsQuery.isError}
          isFetching={listingsQuery.isFetching}
          isLoading={listingsQuery.isLoading}
          listings={listingsQuery.listings}
          onCancel={handleCancel}
          onChangePrice={handleChangePrice}
          onRetry={() => {
            void listingsQuery.refetch();
          }}
        />
      </div>
    </section>
  );
}
