import { prepareGachaRitualAudioAssets } from "../../../platform/audio/gachaRitualAudio.ts";
import { prepareGachaAstralField } from "../GachaAstralFieldRenderer.ts";

export {
  GachaHatchAnimation,
  GachaImageUnavailable,
} from "../GachaHatchAnimation.tsx";
export {
  GachaResultDialog,
  GachaResultImagePreloader,
} from "../GachaResultDialog.tsx";
export type { GachaHatchTier } from "../context.ts";
import "../../../shared/styles/gacha-presentation.css";
import "../gacha-ritual.css";
import "../gacha-ten-stage.css";

export function prepareGachaPresentation(): void {
  prepareGachaAstralField();
  prepareGachaRitualAudioAssets();
}
