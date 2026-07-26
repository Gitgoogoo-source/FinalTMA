import Phaser from "./lib/phaser.js";
import { postToParent } from "./bridge.js";
import { PetHomeScene } from "./scenes/pet-home-scene.js";

const PARENT_SOURCE = "pokepets.monster-home";
const container = document.querySelector("#game-container");
const status = document.querySelector("#entry-status");
let game;

if (!(container instanceof HTMLElement) || !(status instanceof HTMLElement))
  throw new Error("Monster Tamer mount points are missing.");
if (new URLSearchParams(location.search).get("embedded") === "1")
  status.hidden = true;

window.addEventListener("message", (event) => {
  if (
    event.origin !== window.location.origin ||
    event.source !== window.parent ||
    !event.data ||
    typeof event.data !== "object" ||
    event.data.source !== PARENT_SOURCE
  )
    return;
  if (event.data.type === "resume") {
    game?.loop.wake();
    game?.scene.resume("PET_HOME");
    return;
  }
  if (event.data.type === "pause") {
    game?.events.emit("blur");
    game?.scene.pause("PET_HOME");
    game?.loop.sleep();
    return;
  }
  if (event.data.type !== "init" || game) return;
  const items = normalizeItems(event.data.items);
  status.hidden = true;
  game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: container,
    backgroundColor: "#47aba9",
    pixelArt: true,
    render: { antialias: false, roundPixels: true },
    scale: {
      parent: container,
      mode: Phaser.Scale.RESIZE,
      width: container.clientWidth,
      height: container.clientHeight,
    },
    scene: [
      new PetHomeScene({
        items,
        reducedMotion: event.data.reducedMotion === true,
      }),
    ],
  });
});

window.addEventListener("error", (event) => {
  postToParent({
    type: "runtime-error",
    message: event.message || "Monster Tamer 渲染失败",
  });
});

window.addEventListener(
  "pagehide",
  () => {
    game?.destroy(true);
    game = undefined;
  },
  { once: true },
);

postToParent({ type: "ready" });

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.templateId !== "string" ||
      !item.templateId ||
      typeof item.name !== "string" ||
      !item.name ||
      typeof item.imageThumbnailPath !== "string" ||
      !item.imageThumbnailPath.startsWith("/assets/catalog/v1/thumb/")
    )
      continue;
    unique.set(item.templateId, {
      templateId: item.templateId,
      name: item.name,
      imageThumbnailPath: item.imageThumbnailPath,
    });
  }
  return [...unique.values()];
}
