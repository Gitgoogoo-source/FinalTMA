export type AstralFieldColor = readonly [number, number, number];

export type AstralFieldFrame = {
  buildProgress: number;
  color: AstralFieldColor;
  elapsedMs: number;
  revealProgress: number;
};

type AstralFieldRenderer = {
  dispose(): void;
  render(frame: AstralFieldFrame): void;
  resize(): void;
};

type AstralFieldOptions = {
  lowPower: boolean;
  reducedMotion: boolean;
};

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FIELD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform float u_aspect;
uniform float u_build;
uniform vec3 u_color;
uniform float u_reveal;
uniform float u_time;
out vec4 out_color;

float ring(float radius, float target, float width) {
  return exp(-abs(radius - target) * width);
}

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  p.x *= u_aspect;
  vec2 portal = vec2(0.0, 0.0);
  vec2 q = p - portal;
  float build = smoothstep(0.0, 1.0, u_build);
  float growth = pow(build, 0.76);
  float breath = sin(u_time * 7.65 + 0.4);
  float holeRadius = mix(0.026, 0.23, growth)
    * (1.0 + breath * mix(0.08, 0.145, build));
  float radius = length(q);
  float normalizedRadius = radius / max(holeRadius, 0.001);
  float angle = atan(q.y, q.x);

  float eventHorizon = 1.0 - smoothstep(holeRadius * 0.94, holeRadius * 1.02, radius);
  float photonRing = ring(normalizedRadius, 1.04, 15.0);
  float innerGlow = ring(normalizedRadius, 1.16, 7.5);
  float outerWindow = smoothstep(3.8, 1.18, normalizedRadius)
    * smoothstep(0.96, 1.12, normalizedRadius);
  float spiralPhase = angle * 3.0 - normalizedRadius * 5.8 + u_time * 2.15;
  float spiralArms = pow(0.5 + 0.5 * cos(spiralPhase), 7.0);
  float counterSpiral = pow(
    0.5 + 0.5 * cos(angle * 2.0 + normalizedRadius * 7.2 - u_time * 1.35),
    10.0
  );
  float dustNoise = 0.42 + hash(floor(q * 180.0 + u_time * 2.0)) * 0.58;
  float accretion = outerWindow
    * (0.2 + spiralArms * 0.9 + counterSpiral * 0.48)
    * dustNoise
    * smoothstep(0.03, 0.34, build);
  float halo = exp(-max(0.0, normalizedRadius - 1.0) * 1.35)
    * (1.0 - eventHorizon)
    * smoothstep(0.01, 0.24, build);

  float shockRadius = holeRadius + u_reveal * 1.24;
  float shock = ring(radius, shockRadius, 54.0)
    * smoothstep(0.02, 0.14, u_reveal)
    * (1.0 - smoothstep(0.72, 1.0, u_reveal));
  float burst = sin(clamp(u_reveal, 0.0, 1.0) * 3.14159265);
  float impact = exp(-radius * mix(3.6, 0.72, u_reveal)) * burst;
  float impactCross = (
      exp(-abs(q.x) * 21.0) + exp(-abs(q.y) * 21.0)
    ) * burst * 0.22;

  vec3 gold = vec3(1.0, 0.64, 0.19);
  vec3 champagne = vec3(1.0, 0.91, 0.7);
  vec3 accent = mix(gold, u_color, u_reveal * 0.32);
  vec3 lightColor = mix(accent, champagne, 0.36 + photonRing * 0.34);
  float light = photonRing * (0.82 + build * 0.76)
    + innerGlow * 0.44
    + accretion * 1.08
    + halo * 0.2
    + shock * 1.36
    + impact * 1.48
    + impactCross;
  float alpha = clamp(
    photonRing * 0.9
      + innerGlow * 0.48
      + accretion * 0.9
      + halo * 0.17
      + shock
      + impact * 0.88
      + impactCross
      + eventHorizon * 0.995,
    0.0,
    1.0
  );
  vec3 blackCore = vec3(0.0015, 0.0018, 0.0022);
  vec3 color = mix(lightColor * light, blackCore, eventHorizon);
  color = mix(color, champagne * (1.1 + impact * 0.8), clamp(impact * 0.74, 0.0, 0.92));
  out_color = vec4(color, alpha);
}`;

const STAR_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec4 a_star;
in vec2 a_corner;
uniform float u_aspect;
uniform float u_build;
uniform float u_pixel_ratio;
uniform float u_reveal;
uniform float u_time;
out float v_alpha;
out float v_core;

void main() {
  float build = smoothstep(0.0, 1.0, u_build);
  float growth = pow(build, 0.76);
  float breath = sin(u_time * 7.65 + 0.4);
  float holeRadius = mix(0.026, 0.23, growth)
    * (1.0 + breath * mix(0.08, 0.145, build));
  float speed = mix(0.055, 0.31, smoothstep(0.02, 0.92, build));
  float travel = fract(a_star.z + u_time * speed * (0.5 + a_star.w * 0.56));
  float fall = pow(travel, 0.78);
  float seedRadius = length(a_star.xy);
  float baseAngle = atan(a_star.y, a_star.x);
  float angle = baseAngle
    + fall * (5.0 + seedRadius * 2.7)
    + u_time * (0.18 + a_star.w * 0.12);
  float radius = mix(1.72 + seedRadius * 0.42, holeRadius * 1.04, fall);
  vec2 radial = vec2(cos(angle), sin(angle));
  vec2 tangent = vec2(-radial.y, radial.x);
  vec2 center = vec2(radial.x * radius / u_aspect, radial.y * radius);
  vec2 motion = normalize(
    -radial * mix(0.54, 1.08, fall) + tangent * mix(1.42, 0.78, fall)
  );
  vec2 screenMotion = normalize(vec2(motion.x / u_aspect, motion.y));
  vec2 screenNormal = vec2(-screenMotion.y, screenMotion.x);
  float streakLength = mix(0.006, 0.056, build)
    * (0.62 + a_star.w * 0.96)
    * mix(0.72, 1.28, fall);
  float width = (0.0014 + a_star.w * 0.002 + fall * 0.0018)
    * u_pixel_ratio;
  vec2 position = center
    + screenMotion * a_corner.y * streakLength
    + screenNormal * a_corner.x * width;

  v_alpha = smoothstep(0.0, 0.09, travel)
    * (1.0 - smoothstep(0.83, 1.0, travel));
  v_alpha *= mix(0.2, 1.18, build) * (0.46 + a_star.w * 0.78);
  v_alpha *= 1.0 - u_reveal * 0.34;
  v_core = 1.0 - abs(a_corner.x);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const STAR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_alpha;
in float v_core;
uniform vec3 u_color;
uniform float u_reveal;
out vec4 out_color;

void main() {
  float edge = smoothstep(0.0, 0.34, v_core);
  vec3 gold = vec3(1.0, 0.63, 0.16);
  vec3 champagne = vec3(1.0, 0.93, 0.76);
  vec3 color = mix(gold, u_color, u_reveal * 0.38);
  color = mix(color, champagne, 0.32 + edge * 0.42);
  out_color = vec4(color, v_alpha * edge);
}`;

export function createGachaAstralField(
  canvas: HTMLCanvasElement,
  options: AstralFieldOptions,
): AstralFieldRenderer {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: !options.lowPower,
    depth: false,
    desynchronized: true,
    failIfMajorPerformanceCaveat: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false,
  });

  if (!context) {
    canvas.dataset.astralRenderer = "canvas2d";
    return createCanvasFallback(canvas, options);
  }

  try {
    const renderer = new WebGlAstralField(context, canvas, options);
    canvas.dataset.astralRenderer = "webgl2";
    return renderer;
  } catch {
    canvas.dataset.astralRenderer = "unavailable";
    return createNoopRenderer();
  }
}

class WebGlAstralField implements AstralFieldRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #field: ProgramBundle;
  readonly #fullscreenBuffer: WebGLBuffer;
  readonly #fullscreenVao: WebGLVertexArrayObject;
  readonly #gl: WebGL2RenderingContext;
  readonly #pixelRatioLimit: number;
  readonly #star: ProgramBundle;
  readonly #starBuffer: WebGLBuffer;
  readonly #starCount: number;
  readonly #starVao: WebGLVertexArrayObject;
  readonly #starVertexCount: number;
  #height = 0;
  #pixelRatio = 1;
  #width = 0;

  constructor(
    gl: WebGL2RenderingContext,
    canvas: HTMLCanvasElement,
    options: AstralFieldOptions,
  ) {
    this.#canvas = canvas;
    this.#gl = gl;
    this.#pixelRatioLimit = options.lowPower ? 1 : 1.25;
    this.#starCount = options.reducedMotion ? 96 : options.lowPower ? 320 : 520;
    canvas.dataset.astralQuality = options.reducedMotion
      ? "reduced-motion"
      : options.lowPower
        ? "low-power"
        : "standard";
    canvas.dataset.astralStarCount = String(this.#starCount);

    this.#field = createProgramBundle(
      gl,
      FULLSCREEN_VERTEX_SHADER,
      FIELD_FRAGMENT_SHADER,
    );
    this.#star = createProgramBundle(
      gl,
      STAR_VERTEX_SHADER,
      STAR_FRAGMENT_SHADER,
    );

    this.#fullscreenVao = requireResource(gl.createVertexArray());
    this.#fullscreenBuffer = requireResource(gl.createBuffer());
    gl.bindVertexArray(this.#fullscreenVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#fullscreenBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    enableAttribute(gl, this.#field, "a_position", 2, 8, 0);

    const starData = createStarGeometry(this.#starCount);
    this.#starVertexCount = starData.length / 6;
    this.#starVao = requireResource(gl.createVertexArray());
    this.#starBuffer = requireResource(gl.createBuffer());
    gl.bindVertexArray(this.#starVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#starBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, starData, gl.STATIC_DRAW);
    enableAttribute(gl, this.#star, "a_star", 4, 24, 0);
    enableAttribute(gl, this.#star, "a_corner", 2, 24, 16);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
  }

  resize(): void {
    const bounds = this.#canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      this.#pixelRatioLimit,
    );
    if (
      width === this.#width &&
      height === this.#height &&
      pixelRatio === this.#pixelRatio
    )
      return;
    this.#width = width;
    this.#height = height;
    this.#pixelRatio = pixelRatio;
    this.#canvas.dataset.astralPixelRatio = pixelRatio.toFixed(2);
    this.#canvas.width = Math.round(width * pixelRatio);
    this.#canvas.height = Math.round(height * pixelRatio);
  }

  render(frame: AstralFieldFrame): void {
    const gl = this.#gl;
    const build = clamp(frame.buildProgress);
    const reveal = easeOutCubic(clamp(frame.revealProgress));
    const time = frame.elapsedMs / 1_000;
    const aspect = Math.max(0.1, this.#width / Math.max(1, this.#height));

    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    gl.useProgram(this.#star.program);
    setUniform1f(gl, this.#star, "u_aspect", aspect);
    setUniform1f(gl, this.#star, "u_build", build);
    setUniform3f(gl, this.#star, "u_color", frame.color);
    setUniform1f(gl, this.#star, "u_pixel_ratio", this.#pixelRatio);
    setUniform1f(gl, this.#star, "u_reveal", reveal);
    setUniform1f(gl, this.#star, "u_time", time);
    gl.bindVertexArray(this.#starVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.#starVertexCount);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.#field.program);
    setUniform1f(gl, this.#field, "u_aspect", aspect);
    setUniform1f(gl, this.#field, "u_build", build);
    setUniform3f(gl, this.#field, "u_color", frame.color);
    setUniform1f(gl, this.#field, "u_reveal", reveal);
    setUniform1f(gl, this.#field, "u_time", time);
    gl.bindVertexArray(this.#fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.#gl;
    gl.deleteBuffer(this.#fullscreenBuffer);
    gl.deleteBuffer(this.#starBuffer);
    gl.deleteVertexArray(this.#fullscreenVao);
    gl.deleteVertexArray(this.#starVao);
    gl.deleteProgram(this.#field.program);
    gl.deleteProgram(this.#star.program);
  }
}

function createCanvasFallback(
  canvas: HTMLCanvasElement,
  options: AstralFieldOptions,
): AstralFieldRenderer {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return createNoopRenderer();
  const starCount = options.reducedMotion ? 48 : options.lowPower ? 120 : 180;
  canvas.dataset.astralQuality = options.reducedMotion
    ? "reduced-motion-fallback"
    : options.lowPower
      ? "low-power-fallback"
      : "standard-fallback";
  canvas.dataset.astralStarCount = String(starCount);
  const random = seededRandom(0x51a7f13d);
  const stars = Array.from({ length: starCount }, () => ({
    angle: random() * Math.PI * 2,
    phase: random(),
    seedRadius: 0.35 + random() * 0.9,
    size: 0.4 + random() * 0.9,
  }));
  let width = 0;
  let height = 0;
  let ratio = 1;

  return {
    dispose() {},
    resize() {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      ratio = Math.min(
        window.devicePixelRatio || 1,
        options.lowPower ? 1 : 1.1,
      );
      canvas.dataset.astralPixelRatio = ratio.toFixed(2);
      const nextWidth = Math.round(width * ratio);
      const nextHeight = Math.round(height * ratio);
      if (canvas.width === nextWidth && canvas.height === nextHeight) return;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    },
    render(frame) {
      const build = clamp(frame.buildProgress);
      const reveal = easeOutCubic(clamp(frame.revealProgress));
      const time = frame.elapsedMs / 1_000;
      const speed = mix(0.055, 0.31, smoothstep(0.02, 0.92, build));
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const growth = Math.pow(build, 0.76);
      const holeRadius =
        height *
        mix(0.013, 0.115, growth) *
        (1 + Math.sin(time * 7.65 + 0.4) * mix(0.08, 0.145, build));
      const accent = colorToCss(
        mixColor([1, 0.64, 0.19], frame.color, reveal * 0.32),
      );
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      stars.forEach((star) => {
        const travel =
          (star.phase + time * speed * (0.5 + star.size * 0.56)) % 1;
        const fall = Math.pow(travel, 0.78);
        const previousFall = Math.max(0, fall - (0.014 + build * 0.024));
        const outerRadius =
          Math.hypot(width, height) * (0.53 + star.seedRadius * 0.08);
        const radius = mix(outerRadius, holeRadius * 1.04, fall);
        const previousRadius = mix(
          outerRadius,
          holeRadius * 1.04,
          previousFall,
        );
        const angle =
          star.angle +
          fall * (5 + star.seedRadius * 2.7) +
          time * (0.18 + star.size * 0.12);
        const previousAngle =
          star.angle +
          previousFall * (5 + star.seedRadius * 2.7) +
          time * (0.18 + star.size * 0.12);
        const endX = centerX + Math.cos(angle) * radius;
        const endY = centerY + Math.sin(angle) * radius;
        const startX = centerX + Math.cos(previousAngle) * previousRadius;
        const startY = centerY + Math.sin(previousAngle) * previousRadius;
        const alpha =
          smoothstep(0, 0.09, travel) * (1 - smoothstep(0.83, 1, travel));
        context.strokeStyle = `rgba(${accent}, ${Math.min(1, alpha * (0.2 + build * 0.98) * (1 - reveal * 0.34))})`;
        context.lineWidth = 0.65 + star.size * 1.35;
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
      });

      const haloGradient = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        holeRadius * 3.5,
      );
      haloGradient.addColorStop(0, `rgba(${accent}, 0)`);
      haloGradient.addColorStop(
        0.28,
        `rgba(${accent}, ${0.28 + build * 0.18})`,
      );
      haloGradient.addColorStop(1, `rgba(${accent}, 0)`);
      context.fillStyle = haloGradient;
      context.beginPath();
      context.arc(centerX, centerY, holeRadius * 3.5, 0, Math.PI * 2);
      context.fill();

      for (let arcIndex = 0; arcIndex < 7; arcIndex += 1) {
        const arcRadius = holeRadius * (1.08 + arcIndex * 0.24);
        const arcStart = time * (0.72 + arcIndex * 0.035) + arcIndex * 1.37;
        context.strokeStyle = `rgba(${accent}, ${Math.max(0.08, 0.5 - arcIndex * 0.052) * build})`;
        context.lineWidth = Math.max(0.8, 3.2 - arcIndex * 0.31);
        context.beginPath();
        context.arc(
          centerX,
          centerY,
          arcRadius,
          arcStart,
          arcStart + Math.PI * (0.52 + arcIndex * 0.12),
        );
        context.stroke();
      }
      context.restore();

      const coreGradient = context.createRadialGradient(
        centerX - holeRadius * 0.16,
        centerY - holeRadius * 0.14,
        0,
        centerX,
        centerY,
        holeRadius,
      );
      coreGradient.addColorStop(0, "rgba(0, 0, 0, 1)");
      coreGradient.addColorStop(0.78, "rgba(1, 2, 3, 1)");
      coreGradient.addColorStop(1, "rgba(5, 5, 4, 0.98)");
      context.fillStyle = coreGradient;
      context.beginPath();
      context.arc(centerX, centerY, holeRadius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = `rgba(${accent}, ${0.76 + build * 0.2})`;
      context.lineWidth = Math.max(1.5, holeRadius * 0.025);
      context.beginPath();
      context.arc(centerX, centerY, holeRadius * 1.025, 0, Math.PI * 2);
      context.stroke();

      const burst = Math.sin(reveal * Math.PI);
      if (burst > 0.001) {
        const burstGradient = context.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          Math.hypot(width, height) * 0.72,
        );
        burstGradient.addColorStop(0, `rgba(255, 252, 232, ${burst})`);
        burstGradient.addColorStop(0.18, `rgba(${accent}, ${burst * 0.9})`);
        burstGradient.addColorStop(1, `rgba(${accent}, 0)`);
        context.save();
        context.globalCompositeOperation = "screen";
        context.fillStyle = burstGradient;
        context.fillRect(0, 0, width, height);
        context.restore();
      }
    },
  };
}

type ProgramBundle = {
  attributes: Map<string, number>;
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
};

function createProgramBundle(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): ProgramBundle {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = requireResource(gl.createProgram());
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message =
      gl.getProgramInfoLog(program) || "WebGL program link failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return { attributes: new Map(), program, uniforms: new Map() };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = requireResource(gl.createShader(type));
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message =
      gl.getShaderInfoLog(shader) || "WebGL shader compile failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function enableAttribute(
  gl: WebGL2RenderingContext,
  bundle: ProgramBundle,
  name: string,
  size: number,
  stride: number,
  offset: number,
): void {
  let location = bundle.attributes.get(name);
  if (location === undefined) {
    location = gl.getAttribLocation(bundle.program, name);
    bundle.attributes.set(name, location);
  }
  if (location < 0) throw new Error(`Missing WebGL attribute ${name}`);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
}

function setUniform1f(
  gl: WebGL2RenderingContext,
  bundle: ProgramBundle,
  name: string,
  value: number,
): void {
  gl.uniform1f(getUniform(gl, bundle, name), value);
}

function setUniform3f(
  gl: WebGL2RenderingContext,
  bundle: ProgramBundle,
  name: string,
  value: AstralFieldColor,
): void {
  gl.uniform3f(getUniform(gl, bundle, name), value[0], value[1], value[2]);
}

function getUniform(
  gl: WebGL2RenderingContext,
  bundle: ProgramBundle,
  name: string,
): WebGLUniformLocation {
  let location = bundle.uniforms.get(name);
  if (location === undefined) {
    const nextLocation = gl.getUniformLocation(bundle.program, name);
    if (!nextLocation) throw new Error(`Missing WebGL uniform ${name}`);
    location = nextLocation;
    bundle.uniforms.set(name, location);
  }
  return location;
}

function createStarGeometry(count: number): Float32Array {
  const random = seededRandom(0x51a7f13d);
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const;
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 0.35 + random() * 0.9;
    const star = [
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      random(),
      0.35 + random() * 0.65,
    ] as const;
    corners.forEach((corner) => values.push(...star, corner[0], corner[1]));
  }
  return new Float32Array(values);
}

function createNoopRenderer(): AstralFieldRenderer {
  return { dispose() {}, render() {}, resize() {} };
}

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function requireResource<T>(resource: T | null): T {
  if (resource === null) throw new Error("WebGL resource allocation failed");
  return resource;
}

function colorToCss(color: AstralFieldColor): string {
  return color.map((channel) => Math.round(clamp(channel) * 255)).join(", ");
}

function mixColor(
  from: AstralFieldColor,
  to: AstralFieldColor,
  amount: number,
): AstralFieldColor {
  return [
    mix(from[0], to[0], amount),
    mix(from[1], to[1], amount),
    mix(from[2], to[2], amount),
  ];
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}
