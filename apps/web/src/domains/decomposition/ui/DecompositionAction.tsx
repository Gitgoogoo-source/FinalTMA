import { Flame } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

export function DecompositionAction({
  item,
  imageReady,
  disabled,
}: {
  item: {
    template_id: string;
    available: number;
  };
  imageReady: boolean;
  disabled: boolean;
}): ReactNode {
  const { run } = useOperationRegistry();
  return (
    <Button
      disabled={disabled || !imageReady || item.available < 1}
      onClick={() =>
        void run("正在确认分解结果", "inventory.decompose", {
          template_id: item.template_id,
          quantity: 1,
        })
      }
    >
      <Flame />
      分解
    </Button>
  );
}
