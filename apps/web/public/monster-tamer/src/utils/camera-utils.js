/**
 * @param {Phaser.GameObjects.Sprite} gameObject
 * @param {import("../types/typedef").CameraRegion[]} cameraRegions
 */
function getCameraRegionsForGameObject(gameObject, cameraRegions) {
  return cameraRegions.filter((region) => {
    return (
      gameObject.x >= region.x &&
      gameObject.x <= region.x + region.width &&
      gameObject.y >= region.y &&
      gameObject.y <= region.y + region.height
    );
  });
}

/**
 * @param {import("../types/typedef").CameraRegion[]} cameraRegions
 */
function getUnionBoundsForCameraBounds(cameraRegions) {
  if (cameraRegions.length === 0) {
    return undefined;
  }
  const minX = Math.min(...cameraRegions.map((region) => region.x));
  const maxX = Math.max(...cameraRegions.map((region) => region.x + region.width));
  const minY = Math.min(...cameraRegions.map((region) => region.y));
  const maxY = Math.max(...cameraRegions.map((region) => region.y + region.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Updates the main camera bounds in a phaser scene based on the provided
 * game objects position and the available camera regions.
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Sprite} gameObject
 * @param {import("../types/typedef").CameraRegion[]} cameraRegions
 * @param {{ x: number, y: number, width: number, height: number }} fallbackBounds
 */
export function updateMainCameraBounds(scene, gameObject, cameraRegions, fallbackBounds) {
  const filteredRegions = getCameraRegionsForGameObject(gameObject, cameraRegions);
  const unionBounds =
    filteredRegions.length === 0 ? fallbackBounds : getUnionBoundsForCameraBounds(filteredRegions);
  if (unionBounds === undefined) {
    return;
  }
  const { width: viewportWidth, height: viewportHeight } = scene.scale.gameSize;
  const zoom = Math.max(
    0.8,
    viewportWidth / unionBounds.width,
    viewportHeight / unionBounds.height
  );
  scene.cameras.main
    .setBounds(unionBounds.x, unionBounds.y, unionBounds.width, unionBounds.height)
    .setZoom(zoom)
    .setRoundPixels(true);
}
