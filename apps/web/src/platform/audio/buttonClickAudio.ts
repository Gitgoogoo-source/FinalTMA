const BUTTON_CLICK_VOLUME = 0.35;
const AUDIO_PLAYER_COUNT = 3;
const BUTTON_TARGET_SELECTOR = [
  "button",
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="image"]',
  '[role="button"]',
  '[role="radio"]',
  '[role="tab"]',
].join(",");
const BUTTON_CLICK_SOUND_URL = new URL(
  "./button-click-music.mp3",
  import.meta.url,
).href;

const dispose = installButtonClickAudio();
if (import.meta.hot) import.meta.hot.dispose(dispose);

function installButtonClickAudio(): () => void {
  const players = Array.from({ length: AUDIO_PLAYER_COUNT }, createPlayer);
  let nextPlayer = 0;

  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control = event.target.closest(BUTTON_TARGET_SELECTOR);
    if (!control || isUnavailable(control)) return;

    const availablePlayer = players.findIndex(
      (player) => player.paused || player.ended,
    );
    const playerIndex = availablePlayer === -1 ? nextPlayer : availablePlayer;
    nextPlayer = (playerIndex + 1) % players.length;
    const player = players[playerIndex];
    if (!player) return;

    try {
      player.currentTime = 0;
    } catch {
      // Metadata can still be loading on a player's first mobile tap.
    }
    try {
      void player.play().catch(() => undefined);
    } catch {
      // Sound is presentation-only and must never block the button action.
    }
  };

  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    for (const player of players) player.pause();
  };
}

function createPlayer(): HTMLAudioElement {
  const player = new Audio(BUTTON_CLICK_SOUND_URL);
  player.preload = "auto";
  player.volume = BUTTON_CLICK_VOLUME;
  return player;
}

function isUnavailable(control: Element): boolean {
  return (
    control.matches(":disabled") ||
    control.getAttribute("aria-disabled") === "true" ||
    control.closest("[inert], [hidden]") !== null
  );
}
