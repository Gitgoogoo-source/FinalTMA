import { Dna } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

export function EvolutionAction({
  item,
  imageReady,
  disabled,
}: {
  item: {
    template_id: string;
    available: number;
    stage: number;
  };
  imageReady: boolean;
  disabled: boolean;
}): ReactNode {
  const { run } = useOperationRegistry();
  return (
    <Button
      disabled={
        disabled || !imageReady || item.available < 3 || item.stage >= 3
      }
      onClick={() =>
        void run("正在确认进化结果", "inventory.evolve", {
          template_id: item.template_id,
        })
      }
    >
      <Dna />
      进化
    </Button>
  );
}
