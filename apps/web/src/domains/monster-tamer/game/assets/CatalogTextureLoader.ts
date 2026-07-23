import type Phaser from "phaser";

export class CatalogTextureLoader {
  private readonly ownedTextureKeys = new Set<string>();
  private destroyed = false;

  public constructor(private readonly scene: Phaser.Scene) {}

  public async loadCircularThumbnail(
    templateId: string,
    path: string,
    size = 72,
  ): Promise<string | null> {
    const key = this.textureKey("thumb", templateId, path);
    if (this.scene.textures.exists(key)) return key;

    try {
      const image = await loadImage(path);
      if (this.destroyed || !this.scene.sys.isActive()) return null;
      if (this.scene.textures.exists(key)) return key;

      const texture = this.scene.textures.createCanvas(key, size, size);
      if (!texture) return null;
      const context = texture.getContext();
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;

      context.imageSmoothingEnabled = true;
      context.save();
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      context.clip();
      context.drawImage(
        image,
        (size - width) / 2,
        (size - height) / 2,
        width,
        height,
      );
      context.restore();
      texture.refresh();
      this.ownedTextureKeys.add(key);
      return key;
    } catch {
      return null;
    }
  }

  public async loadDetail(
    templateId: string,
    path: string,
  ): Promise<string | null> {
    const key = this.textureKey("detail", templateId, path);
    if (this.scene.textures.exists(key)) return key;

    try {
      const image = await loadImage(path);
      if (this.destroyed || !this.scene.sys.isActive()) return null;
      if (this.scene.textures.exists(key)) return key;
      this.scene.textures.addImage(key, image);
      this.ownedTextureKeys.add(key);
      return key;
    } catch {
      return null;
    }
  }

  public destroy(): void {
    this.destroyed = true;
    for (const key of this.ownedTextureKeys) {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
    this.ownedTextureKeys.clear();
  }

  private textureKey(
    purpose: "detail" | "thumb",
    templateId: string,
    path: string,
  ): string {
    const safeId = templateId.replaceAll(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    return `monster-${purpose}-${safeId}-${hash(path)}`;
  }
}

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Catalog image failed to load: ${path}`));
    image.src = path;
  });
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}
