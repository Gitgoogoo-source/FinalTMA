import { ListingStatsPanel } from "../components/ListingStatsPanel";
import { useMyListingStats } from "../hooks/useMyListings";

export function ManageListingsPage() {
  const statsQuery = useMyListingStats();

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
      </div>
    </section>
  );
}
