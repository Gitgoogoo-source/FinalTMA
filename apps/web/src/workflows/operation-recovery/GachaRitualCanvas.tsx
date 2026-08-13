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
  phase: number;
  radius: number;
  ribbon: number;
  speed: number;
};

type Point = {
  x: number;
  y: number;
};

const rarityColors: Record<GachaRevealRarity, [number, number, number]> = {
  common: [255, 253, 250],
  rare: [28, 226, 4],
  epic: [161, 102, 255],
  legendary: [255, 74, 48],
  mythic: [255, 156, 0],
};

const neutralGold: [number, number, number] = [255, 184, 73];

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
      : 2;
    const particleBudget = reducedMotion ? 18 : lowPower ? 36 : 58;
    const sparkCount = Math.max(
      14,
      Math.round(particleBudget * (0.76 + rarityRank * 0.06)),
    );
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
      const revealProgress = revealing ? clamp(elapsed / 700) : 0;
      const buildProgress = revealing ? 1 : clamp(elapsed / 3_300);
      const revealEase = easeOutCubic(revealProgress);
      const activeColor =
        revealing && rarity ? rarityColors[rarity] : neutralGold;
      const centerX = width * 0.5;
      const centerY = height * 0.535;
      const span = Math.min(width * 0.92, height * 0.48);

      drawDarkCleanplate(
        context,
        centerX,
        centerY,
        width,
        height,
        buildProgress,
      );
      drawWaterWake(
        context,
        centerX,
        centerY,
        width,
        height,
        buildProgress,
        revealEase,
        activeColor,
      );

      const ribbonAlpha = revealing
        ? Math.max(0, 1 - revealProgress * 0.9)
        : 0.34 + buildProgress * 0.66;
      const ribbonPoints = [0, 1, 2].map((ribbon) =>
        createRibbonPoints(
          centerX,
          centerY,
          span,
          width,
          height,
          ribbon,
          buildProgress,
          revealEase,
        ),
      );
      ribbonPoints.forEach((points, ribbon) => {
        drawSpiritSilk(
          context,
          points,
          width,
          ribbon,
          buildProgress,
          ribbonAlpha,
          activeColor,
        );
      });

      drawSparks(
        context,
        sparks,
        ribbonPoints,
        width,
        revealing ? 3_300 + elapsed : elapsed,
        buildProgress,
        revealEase,
        activeColor,
      );
      drawCore(
        context,
        centerX,
        centerY,
        width,
        buildProgress,
        revealProgress,
        activeColor,
      );

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

  return <canvas ref={canvasRef} className="gacha-spirit-silk-canvas" />;
}

function drawDarkCleanplate(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  buildProgress: number,
): void {
  context.save();
  context.translate(centerX, centerY);
  context.scale(1, 1.18);
  const radius = Math.min(width * 0.64, height * 0.34);
  const gradient = context.createRadialGradient(
    0,
    0,
    radius * 0.08,
    0,
    0,
    radius,
  );
  gradient.addColorStop(0, `rgba(7, 18, 29, ${0.94 + buildProgress * 0.04})`);
  gradient.addColorStop(
    0.56,
    `rgba(9, 24, 37, ${0.92 + buildProgress * 0.05})`,
  );
  gradient.addColorStop(0.82, "rgba(13, 31, 43, 0.82)");
  gradient.addColorStop(1, "rgba(13, 31, 43, 0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawSpiritSilk(
  context: CanvasRenderingContext2D,
  points: Point[],
  width: number,
  ribbon: number,
  buildProgress: number,
  alpha: number,
  color: [number, number, number],
): void {
  const halfWidths = points.map((_, index) => {
    const t = index / Math.max(1, points.length - 1);
    const taper = Math.pow(Math.sin(t * Math.PI), 0.58);
    const breathing = 0.9 + Math.sin(t * Math.PI * 3 + ribbon) * 0.1;
    return width * (ribbon === 1 ? 0.058 : 0.051) * taper * breathing;
  });
  const depth = ribbon === 1 ? 1 : ribbon === 0 ? 0.86 : 0.76;
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points.at(-1) ?? first;
  const bodyGradient = context.createLinearGradient(
    first.x,
    first.y,
    last.x,
    last.y,
  );
  bodyGradient.addColorStop(0, "rgba(255, 253, 250, 0)");
  bodyGradient.addColorStop(
    0.18,
    `rgba(255, 253, 250, ${0.5 * alpha * depth})`,
  );
  bodyGradient.addColorStop(
    0.5,
    `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.25 * alpha * depth})`,
  );
  bodyGradient.addColorStop(
    0.78,
    `rgba(241, 244, 237, ${0.4 * alpha * depth})`,
  );
  bodyGradient.addColorStop(1, "rgba(255, 253, 250, 0)");

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalCompositeOperation = "screen";
  context.shadowBlur = 20 + buildProgress * 10;
  context.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.36 * alpha})`;
  fillRibbon(
    context,
    points,
    halfWidths.map((value) => value * 1.28),
    `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.09 * alpha})`,
  );
  context.shadowBlur = 8;
  fillRibbon(context, points, halfWidths, bodyGradient);
  strokeRibbonEdge(
    context,
    points,
    halfWidths,
    1,
    Math.max(1.1, width * 0.0045),
    `rgba(255, 253, 250, ${0.72 * alpha * depth})`,
  );
  strokeRibbonEdge(
    context,
    points,
    halfWidths,
    -1,
    Math.max(0.9, width * 0.0034),
    `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.6 * alpha * depth})`,
  );
  strokeRibbonEdge(
    context,
    points,
    halfWidths.map((value) => value * 0.22),
    ribbon === 1 ? -1 : 1,
    Math.max(0.7, width * 0.0022),
    `rgba(255, 253, 250, ${0.28 * alpha})`,
  );
  context.restore();
}

function createRibbonPoints(
  centerX: number,
  centerY: number,
  span: number,
  width: number,
  height: number,
  ribbon: number,
  buildProgress: number,
  revealEase: number,
): Point[] {
  const phase = [-0.5, 1.58, 3.76][ribbon] ?? 0;
  const tighten = 1.08 - buildProgress * 0.12;
  const points: Point[] = [];
  for (let index = 0; index <= 52; index += 1) {
    const t = index / 52;
    const angle =
      phase +
      t * Math.PI * (0.92 + buildProgress * 0.14) +
      buildProgress * 0.64 +
      revealEase * (0.48 + t * 0.42) +
      Math.sin(t * Math.PI * 2 + ribbon * 0.7) * 0.08;
    const baseRadius = span * (0.022 + t * (0.39 + ribbon * 0.012));
    const whip = 1 + revealEase * (0.46 + t * 1.38);
    const asymmetricX = Math.sin(t * Math.PI) * width * 0.018 * (ribbon - 1);
    const asymmetricY =
      Math.sin(t * Math.PI * 1.4) * height * 0.012 * (ribbon === 1 ? -1 : 1);
    points.push({
      x: centerX + Math.cos(angle) * baseRadius * tighten * whip + asymmetricX,
      y:
        centerY +
        Math.sin(angle) * baseRadius * 0.8 * tighten * whip +
        asymmetricY,
    });
  }
  return points;
}

function fillRibbon(
  context: CanvasRenderingContext2D,
  points: Point[],
  halfWidths: number[],
  fillStyle: string | CanvasGradient,
): void {
  const positive = offsetRibbonPoints(points, halfWidths, 1);
  const negative = offsetRibbonPoints(points, halfWidths, -1).reverse();
  context.beginPath();
  [...positive, ...negative].forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
}

function strokeRibbonEdge(
  context: CanvasRenderingContext2D,
  points: Point[],
  halfWidths: number[],
  side: 1 | -1,
  lineWidth: number,
  strokeStyle: string,
): void {
  const edge = offsetRibbonPoints(points, halfWidths, side);
  context.beginPath();
  edge.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.lineWidth = lineWidth;
  context.strokeStyle = strokeStyle;
  context.stroke();
}

function offsetRibbonPoints(
  points: Point[],
  offsets: number[],
  side: 1 | -1,
): Point[] {
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)] ?? point;
    const next = points[Math.min(points.length - 1, index + 1)] ?? point;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const offset = (offsets[index] ?? 0) * side;
    return {
      x: point.x - (dy / length) * offset,
      y: point.y + (dx / length) * offset,
    };
  });
}

function drawSparks(
  context: CanvasRenderingContext2D,
  sparks: Spark[],
  ribbons: Point[][],
  width: number,
  elapsed: number,
  buildProgress: number,
  revealEase: number,
  color: [number, number, number],
): void {
  context.save();
  context.globalCompositeOperation = "screen";
  sparks.forEach((spark, index) => {
    const ribbon = ribbons[spark.ribbon] ?? ribbons[0] ?? [];
    if (ribbon.length < 2) return;
    const travel =
      ((spark.distance + elapsed * 0.000032 * spark.speed) % 0.94) + 0.03;
    const pointIndex = Math.min(
      ribbon.length - 1,
      Math.floor(travel * (ribbon.length - 1)),
    );
    const point = ribbon[pointIndex] ?? ribbon[0];
    const previous = ribbon[Math.max(0, pointIndex - 1)] ?? point;
    const next = ribbon[Math.min(ribbon.length - 1, pointIndex + 1)] ?? point;
    if (!point || !previous || !next) return;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const scatter = (spark.phase - 0.5) * width * (0.045 + revealEase * 0.12);
    const x = point.x - (dy / length) * scatter;
    const y = point.y + (dx / length) * scatter;
    const fade = revealingFade(revealEase);
    const alpha = (0.18 + buildProgress * 0.62) * fade;
    const radius = spark.radius * (1 + revealEase * 1.5);

    context.save();
    context.translate(x, y);
    context.rotate(angle + Math.PI * 0.25);
    context.shadowBlur = index % 7 === 0 ? 13 : 7;
    context.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
    context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
    if (index % 7 === 0) {
      context.beginPath();
      context.moveTo(0, -radius * 3.2);
      context.lineTo(radius * 1.2, 0);
      context.lineTo(0, radius * 3.2);
      context.lineTo(-radius * 1.2, 0);
      context.closePath();
      context.fill();
    } else if (index % 5 === 0) {
      context.strokeStyle = `rgba(255, 253, 250, ${alpha * 0.72})`;
      context.lineWidth = Math.max(0.7, radius * 0.55);
      context.beginPath();
      context.moveTo(-radius * 3.4, 0);
      context.quadraticCurveTo(0, -radius, radius * 3.4, 0);
      context.stroke();
    } else {
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  });
  context.restore();
}

function drawWaterWake(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  buildProgress: number,
  revealEase: number,
  color: [number, number, number],
): void {
  const waterY = centerY + height * 0.165;
  context.save();
  context.globalCompositeOperation = "screen";
  context.lineCap = "round";
  context.shadowBlur = 9;
  context.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.5)`;

  for (let index = 0; index < 4; index += 1) {
    const scale = 0.4 + index * 0.22 + buildProgress * 0.16 + revealEase * 0.7;
    context.beginPath();
    context.ellipse(
      centerX,
      waterY,
      width * 0.29 * scale,
      height * 0.018 * scale,
      -0.04 + index * 0.025,
      Math.PI * (0.08 + index * 0.04),
      Math.PI * (1.76 - index * 0.03),
    );
    context.lineWidth = Math.max(0.8, 1.6 - index * 0.16);
    context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(0.52 - index * 0.08) * (0.34 + buildProgress * 0.66) * revealingFade(revealEase)})`;
    context.stroke();
  }

  context.beginPath();
  context.moveTo(centerX, centerY + 8);
  context.bezierCurveTo(
    centerX - width * 0.08,
    centerY + height * 0.06,
    centerX + width * 0.07,
    waterY - height * 0.035,
    centerX,
    waterY,
  );
  context.lineWidth = Math.max(1, width * 0.005);
  context.strokeStyle = `rgba(255, 253, 250, ${0.16 + buildProgress * 0.24})`;
  context.stroke();
  context.restore();
}

function drawCore(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  buildProgress: number,
  revealProgress: number,
  color: [number, number, number],
): void {
  const pulse =
    0.9 +
    Math.max(0, Math.sin(buildProgress * Math.PI * 6 - Math.PI * 0.45)) * 0.18;
  const revealEase = easeOutCubic(revealProgress);
  const radius = width * 0.043 * pulse * (1 + revealEase * 4.8);
  const alpha = revealProgress > 0 ? Math.max(0, 1 - revealProgress) : 1;
  const gradient = context.createRadialGradient(
    centerX,
    centerY,
    0,
    centerX,
    centerY,
    radius,
  );
  gradient.addColorStop(0, `rgba(255, 255, 255, ${0.98 * alpha})`);
  gradient.addColorStop(
    0.2,
    `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.96 * alpha})`,
  );
  gradient.addColorStop(
    0.55,
    `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.36 * alpha})`,
  );
  gradient.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
  context.save();
  context.globalCompositeOperation = "screen";
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  if (revealProgress > 0.04) {
    context.beginPath();
    context.arc(
      centerX,
      centerY,
      width * 0.08 + revealEase * width * 0.46,
      0,
      Math.PI * 2,
    );
    context.lineWidth = Math.max(1, width * (0.009 - revealProgress * 0.006));
    context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Math.max(0, 0.76 - revealProgress * 0.76)})`;
    context.stroke();
  }
  context.restore();
}

function revealingFade(revealEase: number): number {
  return Math.max(0, 1 - revealEase * 0.88);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
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
  return Array.from({ length: count }, (_, index) => ({
    angle: random() * Math.PI * 2,
    distance: random(),
    phase: random(),
    radius: 0.65 + random() * 1.85,
    ribbon: index % 3,
    speed: 0.48 + random() * 0.92,
  }));
}
