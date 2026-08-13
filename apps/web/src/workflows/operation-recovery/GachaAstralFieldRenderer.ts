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

float segmentDistance(vec2 point, vec2 from, vec2 to) {
  vec2 delta = to - from;
  float amount = clamp(dot(point - from, delta) / dot(delta, delta), 0.0, 1.0);
  return length(point - (from + delta * amount));
}

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  p.x *= u_aspect;
  vec2 portal = vec2(0.0, 0.1);
  float build = smoothstep(0.0, 1.0, u_build);
  float travel = pow(build, 0.62);
  vec2 origin = vec2(-0.18, -1.12);
  vec2 comet = mix(origin, portal, travel);
  comet.x += sin(travel * 3.14159265) * 0.24;
  comet.x += sin(u_time * 3.1) * 0.016 * (1.0 - build);

  float portalRadius = length(p - portal);
  float portalRing = ring(portalRadius, 0.12 + u_reveal * 0.09, 72.0);
  float portalHalo = exp(-portalRadius * mix(5.6, 2.6, u_reveal));
  float portalCore = exp(-portalRadius * mix(31.0, 9.0, u_reveal));

  float cometDistance = length((p - comet) * vec2(1.08, 1.0));
  float cometCore = exp(-cometDistance * mix(34.0, 17.0, u_reveal));
  float cometHalo = exp(-cometDistance * 6.2);
  float tailDistance = segmentDistance(p, origin, comet);
  float tailWindow = smoothstep(-1.14, comet.y, p.y)
    * (1.0 - smoothstep(comet.y, comet.y + 0.06, p.y));
  float tail = exp(-tailDistance * 17.0) * tailWindow * smoothstep(0.03, 0.34, build);
  float speedCorridor = exp(-abs(p.x) * 4.8)
    * (1.0 - smoothstep(-0.36, 0.24, p.y))
    * smoothstep(0.22, 0.94, build);

  float shockRadius = u_reveal * 1.12;
  float shock = ring(portalRadius, shockRadius, 48.0)
    * smoothstep(0.02, 0.14, u_reveal)
    * (1.0 - smoothstep(0.72, 1.0, u_reveal));
  float impact = exp(-portalRadius * 2.15)
    * sin(clamp(u_reveal, 0.0, 1.0) * 3.14159265)
    * 0.72;
  float impactCross = (exp(-abs(p.x) * 24.0) + exp(-abs(p.y - portal.y) * 22.0))
    * sin(clamp(u_reveal * 1.18, 0.0, 1.0) * 3.14159265)
    * 0.24;

  vec3 ice = vec3(0.325, 0.847, 1.0);
  vec3 ivory = vec3(0.976, 0.988, 1.0);
  vec3 accent = mix(ice, u_color, u_reveal);
  vec3 color = mix(accent, ivory, 0.28);
  float pulse = 0.88 + 0.12 * sin(u_time * 5.2);
  float light = portalHalo * 0.23 + portalRing * (0.42 + build * 0.56)
    + portalCore * 0.7 + cometCore * pulse * 1.24 + cometHalo * 0.42
    + tail * 0.58 + speedCorridor * 0.1 + shock * 1.18 + impact + impactCross;
  float alpha = clamp(portalHalo * 0.2 + portalRing * 0.62 + portalCore * 0.84
    + cometCore + cometHalo * 0.5 + tail * 0.58 + speedCorridor * 0.08
    + shock * 0.84 + impact + impactCross, 0.0, 1.0);
  out_color = vec4(color * light, alpha);
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
  float buildSpeed = mix(0.06, 0.66, smoothstep(0.06, 0.9, u_build));
  float depth = fract(a_star.z + u_time * buildSpeed * (0.52 + a_star.w * 0.8));
  float perspective = pow(depth, 1.56);
  vec2 direction = normalize(a_star.xy);
  float seedRadius = length(a_star.xy);
  float radius = mix(0.025, 1.94 + seedRadius * 0.56, perspective);
  vec2 center = vec2(direction.x * radius / u_aspect, direction.y * radius + 0.1);

  vec2 radial = normalize(vec2(direction.x / u_aspect, direction.y));
  vec2 tangent = vec2(-radial.y, radial.x);
  float streakLength = mix(0.004, 0.052, u_build)
    + pow(perspective, 1.6) * mix(0.026, 0.31, u_build);
  streakLength *= 0.78 + a_star.w * 0.92;
  float width = (0.0018 + a_star.w * 0.0023 + perspective * 0.0034)
    * u_pixel_ratio;
  vec2 position = center + radial * a_corner.y * streakLength + tangent * a_corner.x * width;

  v_alpha = smoothstep(0.01, 0.12, depth) * (1.0 - smoothstep(0.89, 1.0, depth));
  v_alpha *= mix(0.34, 1.18, u_build) * (0.52 + a_star.w * 0.72);
  v_alpha *= 1.0 - u_reveal * 0.22;
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
  vec3 ice = vec3(0.325, 0.847, 1.0);
  vec3 violet = vec3(0.77, 0.655, 1.0);
  vec3 ivory = vec3(0.976, 0.988, 1.0);
  vec3 neutral = mix(ice, violet, 0.22);
  vec3 color = mix(neutral, u_color, u_reveal);
  color = mix(color, ivory, 0.28 + edge * 0.32);
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
  const stars = Array.from({ length: starCount }, () => {
    const angle = random() * Math.PI * 2;
    const radius = 0.35 + random() * 0.9;
    return {
      directionX: Math.cos(angle) * radius,
      directionY: Math.sin(angle) * radius,
      phase: random(),
      size: 0.4 + random() * 0.9,
    };
  });
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
      const speed = mix(0.06, 0.66, smoothstep(0.06, 0.9, build));
      const centerX = width * 0.5;
      const centerY = height * 0.45;
      const accent = colorToCss(
        mixColor([0.325, 0.847, 1], frame.color, reveal),
      );
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = "lighter";

      stars.forEach((star) => {
        const depth =
          (star.phase + time * speed * (0.52 + star.size * 0.8)) % 1;
        const perspective = Math.pow(depth, 1.56);
        const endX = centerX + star.directionX * width * perspective * 1.08;
        const endY = centerY + star.directionY * height * perspective * 1.08;
        const trail =
          (7 + 104 * Math.pow(perspective, 1.6) * build) * star.size;
        const length = Math.hypot(endX - centerX, endY - centerY) || 1;
        const startX = endX - ((endX - centerX) / length) * trail;
        const startY = endY - ((endY - centerY) / length) * trail;
        const alpha =
          smoothstep(0.01, 0.12, depth) * (1 - smoothstep(0.89, 1, depth));
        context.strokeStyle = `rgba(${accent}, ${Math.min(1, alpha * (0.34 + build * 0.9))})`;
        context.lineWidth = 0.9 + star.size * 1.5;
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
      });

      const travel = Math.pow(build, 0.62);
      const cometY = mix(height * 0.91, centerY, travel);
      const cometX =
        mix(width * 0.41, centerX, travel) +
        Math.sin(travel * Math.PI) * width * 0.12;
      const tailGradient = context.createLinearGradient(
        width * 0.41,
        height,
        cometX,
        cometY,
      );
      tailGradient.addColorStop(0, `rgba(${accent}, 0)`);
      tailGradient.addColorStop(1, `rgba(${accent}, ${0.42 + build * 0.34})`);
      context.strokeStyle = tailGradient;
      context.lineWidth = 8 + build * 9;
      context.beginPath();
      context.moveTo(width * 0.41, height * 1.02);
      context.lineTo(cometX, cometY);
      context.stroke();
      const cometGradient = context.createRadialGradient(
        cometX,
        cometY,
        0,
        cometX,
        cometY,
        36 + reveal * 34,
      );
      cometGradient.addColorStop(0, "rgba(255, 255, 255, 1)");
      cometGradient.addColorStop(0.14, `rgba(${accent}, 0.95)`);
      cometGradient.addColorStop(1, `rgba(${accent}, 0)`);
      context.fillStyle = cometGradient;
      context.beginPath();
      context.arc(cometX, cometY, 36 + reveal * 44, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = `rgba(${accent}, ${0.35 + reveal * 0.45})`;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(centerX, centerY, 28 + reveal * width * 0.52, 0, Math.PI * 2);
      context.stroke();
      context.restore();
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
