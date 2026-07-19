import type { RouteOutput } from "@pokepets/api-contracts";

export type Catalog = RouteOutput<"catalog.get">;
export type CatalogTemplate = Catalog["templates"][number];
