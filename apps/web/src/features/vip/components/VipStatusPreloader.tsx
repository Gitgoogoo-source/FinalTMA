import { useVipStatus } from "../hooks/useVipStatus";

export function VipStatusPreloader() {
  useVipStatus();

  return null;
}
