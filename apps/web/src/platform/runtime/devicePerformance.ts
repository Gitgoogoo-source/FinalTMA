export function isLowPowerAnimationDevice(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator.hardwareConcurrency || 8) <= 4
  );
}
