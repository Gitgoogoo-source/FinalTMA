import { useEffect, useRef, type ReactNode } from "react";

export type GachaRevealRarity =
  | "common"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

type Spark = {
  angle: number;
  distance: number;
  drift: number;
  phase: number;
  radius: number;
  speed: number;
};

const rarityColors: Record<GachaRevealRarity, [number, number, number]> = {
  common: [255, 253, 250],
  rare: [28, 226, 4],
  epic: [161, 102, 255],
  legendary: [255, 74, 48],
  mythic: [255, 156, 0],
};

export function GachaRitualCanvas({
  revealing,
  rarity,
}: {
  revealing: boolean;
  rarity: GachaRevealRarity | null;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
    const rarityRank = rarity
      ? (["common", "rare", "epic", "legendary", "mythic"] as const).indexOf(
          rarity,
        )
      : 4;
    const particleRatio = 0.56 + rarityRank * 0.11;
    const particleBudget = reducedMotion ? 18 : lowPower ? 38 : 64;
    const sparkCount = Math.max(12, Math.round(particleBudget * particleRatio));
    const revealIntensity = 0.72 + rarityRank * 0.1;
    const sparks = createSparks(sparkCount);
    const startedAt = performance.now();
    let animationFrame: number | null = null;
    let width = 0;
    let height = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, bounds.width);
      const nextHeight = Math.max(1, bounds.height);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        lowPower ? 1.25 : 1.75,
      );
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const render = (now: number) => {
      resize();
      context.clearRect(0, 0, width, height);
      const elapsed = Math.max(0, now - startedAt);
      const centerX = width * 0.5;
      const centerY = height * 0.54;
      const revealProgress = revealing ? Math.min(1, elapsed / 700) : 0;
      const buildProgress = revealing ? 1 : Math.min(1, elapsed / 3_300);
      const color = rarity ? rarityColors[rarity] : rarityColors.common;

      sparks.forEach((spark, index) => {
        const baseOrbit =
          Math.min(width, height) * (0.1 + spark.distance * 0.27);
        const orbitAngle =
          spark.angle + buildProgress * spark.speed * 2.2 + spark.phase;
        const burstDistance =
          revealProgress *
          revealProgress *
          Math.min(width, height) *
          spark.speed *
          revealIntensity;
        const orbitCompression = revealing ? 1 - revealProgress * 0.72 : 1;
        const x =
          centerX +
          Math.cos(orbitAngle) * baseOrbit * orbitCompression +
          Math.cos(spark.angle) * burstDistance;
        const y =
          centerY +
          Math.sin(orbitAngle) * baseOrbit * 0.55 * orbitCompression +
          Math.sin(spark.angle) * burstDistance * 0.72 -
          spark.drift * buildProgress * height * 0.05;
        const alpha = revealing
          ? Math.max(0, 1 - revealProgress) * (0.48 + spark.phase * 0.08)
          : 0.12 + buildProgress * 0.52;
        const radius =
          spark.radius * (revealing ? 1 + revealProgress * 1.8 : 1);

        context.save();
        context.translate(x, y);
        context.rotate(spark.angle + revealProgress * 1.8);
        context.shadowBlur = revealing ? 14 : 7;
        context.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
        context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
        if (index % 5 === 0) {
          context.beginPath();
          context.moveTo(0, -radius * 2.2);
          context.lineTo(radius, 0);
          context.lineTo(0, radius * 2.2);
          context.lineTo(-radius, 0);
          context.closePath();
          context.fill();
        } else {
          context.beginPath();
          context.arc(0, 0, radius, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      });

      if (revealing && revealProgress > 0.04) {
        const ringRadius = revealProgress * Math.min(width, height) * 0.44;
        context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Math.max(0, 0.78 - revealProgress * 0.78)})`;
        context.lineWidth = Math.max(1, 4 - revealProgress * 3);
        context.beginPath();
        context.ellipse(
          centerX,
          centerY,
          ringRadius,
          ringRadius * 0.46,
          0,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }

      const animationActive = revealing
        ? revealProgress < 1
        : buildProgress < 1;
      if (!reducedMotion && animationActive)
        animationFrame = window.requestAnimationFrame(render);
    };

    const handleResize = () => render(performance.now());
    window.addEventListener("resize", handleResize);
    render(startedAt + (reducedMotion ? 3_300 : 0));

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
    };
  }, [rarity, revealing]);

  return <canvas ref={canvasRef} className="gacha-ritual-particles" />;
}

function createSparks(count: number): Spark[] {
  let seed = 0x6d2b79f5;
  const random = () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return Array.from({ length: count }, () => ({
    angle: random() * Math.PI * 2,
    distance: random(),
    drift: 0.25 + random() * 0.75,
    phase: random(),
    radius: 0.7 + random() * 2.1,
    speed: 0.45 + random() * 0.95,
  }));
}
