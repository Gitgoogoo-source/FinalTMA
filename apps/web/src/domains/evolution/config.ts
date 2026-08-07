import catalog from "./evolution-catalog-v1.json";

export type EvolutionRarity =
  | "common"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

export type EvolutionRoute = {
  source_template_id: string;
  target: {
    template_id: string;
    name: string;
    rarity: Exclude<EvolutionRarity, "common">;
    stage: number;
  };
  success_rate_percent: number;
  fgems_cost: number;
};

const routes = new Map(
  (catalog.routes as readonly EvolutionRoute[]).map((route) => [
    route.source_template_id,
    route,
  ]),
);

export function evolutionRoute(
  sourceTemplateId: string,
): EvolutionRoute | undefined {
  return routes.get(sourceTemplateId);
}
