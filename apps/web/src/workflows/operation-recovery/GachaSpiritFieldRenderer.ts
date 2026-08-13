export type SpiritFieldColor = readonly [number, number, number];

export type SpiritFieldFrame = {
  buildProgress: number;
  color: SpiritFieldColor;
  elapsedMs: number;
  revealProgress: number;
};

type SpiritFieldRenderer = {
  dispose(): void;
  render(frame: SpiritFieldFrame): void;
  resize(): void;
};

type SpiritFieldOptions = {
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
uniform float u_build;
uniform vec3 u_color;
uniform float u_reveal;
uniform float u_time;
out vec4 out_color;

float ring(float radius, float target, float width) {
  return exp(-abs(radius - target) * width);
}

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  vec2 core = vec2(0.0, -0.035);
  float cleanplateRadius = length(vec2(p.x / 0.82, (p.y + 0.04) / 0.92));
  float cleanplate = (1.0 - smoothstep(0.68, 1.12, cleanplateRadius))
    * mix(0.94, 1.0, u_build);

  float coreDistance = length((p - core) * vec2(1.08, 1.0));
  float coreHot = exp(-coreDistance * mix(21.0, 15.0, u_reveal));
  float coreHalo = exp(-coreDistance * 5.2);
  float pulse = 0.86 + 0.14 * sin(u_time * 5.4);

  vec2 waterPoint = vec2(p.x, (p.y + 0.5) * 6.2);
  float waterRadius = length(waterPoint);
  float waterFade = exp(-abs(p.y + 0.5) * 26.0)
    * (1.0 - smoothstep(0.28, 0.78, abs(p.x)));
  float ripples = 0.0;
  ripples += ring(waterRadius, 0.13 + u_build * 0.015, 68.0);
  ripples += ring(waterRadius, 0.23 + u_build * 0.025, 58.0) * 0.82;
  ripples += ring(waterRadius, 0.35 + u_build * 0.04, 50.0) * 0.62;
  ripples += ring(waterRadius, 0.49 + u_build * 0.055, 42.0) * 0.43;
  ripples *= waterFade * (1.0 - u_reveal * 0.48);

  float tailX = p.x + sin((p.y + 0.42) * 10.0 + u_time * 0.7) * 0.015;
  float tailWindow = smoothstep(-0.72, -0.54, p.y)
    * (1.0 - smoothstep(-0.16, -0.04, p.y));
  float tail = exp(-abs(tailX) * 72.0) * tailWindow;

  float shockRadius = u_reveal * 0.78;
  float shock = ring(length(p - core), shockRadius, 76.0)
    * smoothstep(0.03, 0.14, u_reveal)
    * (1.0 - u_reveal);

  vec3 night = vec3(0.018, 0.052, 0.078);
  vec3 ivory = vec3(1.0, 0.986, 0.93);
  vec3 lightColor = mix(u_color, ivory, 0.28);
  float light = coreHot * pulse * 0.82 + coreHalo * 0.17
    + ripples * 0.7 + tail * 0.44 + shock * 0.92;
  vec3 color = night + lightColor * light;
  float alpha = clamp(cleanplate + coreHalo * 0.2 + ripples * 0.35 + shock * 0.4, 0.0, 1.0);
  out_color = vec4(color, alpha);
}`;

const FLOW_CURVE_GLSL = `
const float PI = 3.14159265359;

vec2 flowCurve(float t, float path) {
  float z = t * 2.0 - 1.0;
  float radial = pow(abs(z), 0.68);
  float phase = -1.7 + path * 0.58;
  float pathBias = (path - 2.5) / 2.5;
  float angle = z * 3.35 + phase + sin(z * PI) * 0.2 + u_build * 0.5
    + u_time * (0.045 + path * 0.003);
  float lobe = 0.2 + radial * (0.36 + 0.024 * mod(path, 3.0));
  vec2 position = vec2(
    sin(angle) * lobe * radial,
    -0.035 + z * 0.32 + cos(angle) * (0.075 + radial * 0.27) * radial
  );
  position.x += sin(z * 6.2 + phase * 1.7) * 0.045 * radial;
  position.x += pathBias * 0.028 * radial;
  position.y += pathBias * 0.024 * radial;
  vec2 core = vec2(0.0, -0.035);
  float loosen = 1.14 - u_build * 0.12;
  float release = 1.0 + u_reveal * (0.42 + radial * 0.98);
  return core + (position - core) * loosen * release;
}`;

const RIBBON_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 a_ribbon;
uniform float u_build;
uniform float u_reveal;
uniform float u_time;
out vec3 v_ribbon;
out float v_radial;

${FLOW_CURVE_GLSL}

void main() {
  float t = a_ribbon.x;
  float side = a_ribbon.y;
  float path = a_ribbon.z;
  float epsilon = 0.0035;
  vec2 center = flowCurve(t, path);
  vec2 before = flowCurve(max(0.0, t - epsilon), path);
  vec2 after = flowCurve(min(1.0, t + epsilon), path);
  vec2 tangent = normalize(after - before);
  vec2 normal = vec2(-tangent.y, tangent.x);
  float z = t * 2.0 - 1.0;
  float radial = pow(abs(z), 0.68);
  float taper = smoothstep(0.0, 0.1, t) * smoothstep(0.0, 0.1, 1.0 - t);
  float breathing = 0.84 + 0.16 * sin(t * 17.0 + path * 1.9 + u_time * 0.36);
  float width = (0.078 + radial * 0.074) * taper * breathing;
  vec2 position = center + normal * side * width;
  gl_Position = vec4(position, 0.0, 1.0);
  v_ribbon = vec3(t, side, path);
  v_radial = radial;
}`;

const RIBBON_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_ribbon;
in float v_radial;
uniform float u_alpha;
uniform vec3 u_color;
uniform float u_reveal;
uniform float u_time;
out vec4 out_color;

float hash(float value) {
  return fract(sin(value * 127.1) * 43758.5453);
}

void main() {
  float t = v_ribbon.x;
  float side = abs(v_ribbon.y);
  float path = v_ribbon.z;
  float taper = smoothstep(0.0, 0.11, t) * smoothstep(0.0, 0.11, 1.0 - t);
  float body = pow(max(0.0, 1.0 - side), 1.35);
  float outerEdge = exp(-pow((side - 0.84) * 9.2, 2.0));
  float innerEdge = exp(-pow((side - 0.3) * 13.0, 2.0));
  float fiberWaveA = sin(side * 38.0 + t * 82.0 + path * 4.7 + u_time * 0.8);
  float fiberWaveB = sin(side * 69.0 - t * 121.0 + path * 7.3 - u_time * 0.42);
  float fibersA = pow(max(0.0, fiberWaveA * 0.5 + 0.5), 9.0);
  float fibersB = pow(max(0.0, fiberWaveB * 0.5 + 0.5), 16.0);
  float fibers = max(fibersA, fibersB * 0.82);
  float grain = mix(0.68, 1.0, hash(floor(t * 230.0) + path * 37.0));
  float breakup = 0.82 + 0.18 * sin(t * 44.0 + side * 9.0 + path);
  float alpha = (
    body * 0.24
    + outerEdge * 0.28
    + innerEdge * 0.16
    + fibers * 0.22
  ) * taper * grain * breakup * u_alpha;
  alpha *= 1.0 - u_reveal * 0.58;

  vec3 ivory = vec3(1.0, 0.992, 0.955);
  float whiteWeight = clamp(0.12 + outerEdge * 0.36 + fibers * 0.18, 0.0, 1.0);
  vec3 color = mix(u_color, ivory, whiteWeight);
  color *= 0.94 + outerEdge * 0.64 + fibers * 0.62;
  out_color = vec4(color, alpha);
}`;

const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec4 a_particle;
in vec2 a_particle_extra;
uniform float u_build;
uniform float u_pixel_ratio;
uniform float u_reveal;
uniform float u_time;
out float v_alpha;
out float v_seed;
out vec3 v_tint;

${FLOW_CURVE_GLSL}

void main() {
  float travel = fract(a_particle.x + u_time * 0.032 * a_particle_extra.y);
  float path = a_particle.y;
  float seed = a_particle.w;
  vec2 center = flowCurve(travel, path);
  float epsilon = 0.004;
  vec2 tangent = normalize(
    flowCurve(min(1.0, travel + epsilon), path)
      - flowCurve(max(0.0, travel - epsilon), path)
  );
  vec2 normal = vec2(-tangent.y, tangent.x);
  float z = travel * 2.0 - 1.0;
  float radial = pow(abs(z), 0.68);
  float drift = sin(u_time * (0.9 + seed) + seed * 31.0) * 0.012;
  vec2 position = center + normal * (a_particle.z * (0.075 + radial * 0.22) + drift);
  vec2 core = vec2(0.0, -0.035);
  vec2 burstDirection = normalize(position - core + vec2(0.0001));
  position += burstDirection * u_reveal * (0.05 + seed * 0.42);

  float endFade = smoothstep(0.0, 0.055, travel) * smoothstep(0.0, 0.055, 1.0 - travel);
  float coreDistance = abs(travel - 0.5);
  float coreParticleFade = mix(0.28, 1.0, smoothstep(0.055, 0.24, coreDistance));
  v_alpha = endFade * coreParticleFade * mix(0.34, 1.0, u_build)
    * (1.0 - u_reveal * 0.84);
  v_seed = seed;
  v_tint = vec3(radial, travel, path / 5.0);
  gl_PointSize = (2.0 + a_particle_extra.x * 7.2 + u_reveal * 3.2)
    * u_pixel_ratio;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_alpha;
in float v_seed;
in vec3 v_tint;
uniform vec3 u_color;
out vec4 out_color;

void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radius = length(point);
  float roundSpark = exp(-radius * radius * 5.4);
  float diamond = 1.0 - smoothstep(0.45, 1.0, abs(point.x) + abs(point.y));
  float cross = max(
    exp(-abs(point.x) * 13.0) * (1.0 - smoothstep(0.15, 1.0, abs(point.y))),
    exp(-abs(point.y) * 13.0) * (1.0 - smoothstep(0.15, 1.0, abs(point.x)))
  );
  float selector = fract(v_seed * 19.73);
  float shape = selector > 0.86 ? max(diamond, cross * 0.74) : roundSpark;
  if (shape < 0.025) discard;

  vec3 ivory = vec3(1.0, 0.99, 0.94);
  vec3 color = mix(u_color, ivory, 0.08 + selector * 0.46);
  float alpha = shape * v_alpha * mix(0.42, 1.0, selector);
  out_color = vec4(color, alpha);
}`;

export function createGachaSpiritField(
  canvas: HTMLCanvasElement,
  options: SpiritFieldOptions,
): SpiritFieldRenderer {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    depth: false,
    desynchronized: true,
    failIfMajorPerformanceCaveat: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false,
  });

  if (!context) {
    canvas.dataset.spiritRenderer = "canvas2d";
    return createCanvasFallback(canvas, options);
  }

  try {
    const renderer = new WebGlSpiritField(context, canvas, options);
    canvas.dataset.spiritRenderer = "webgl2";
    return renderer;
  } catch {
    canvas.dataset.spiritRenderer = "unavailable";
    return createNoopRenderer();
  }
}

class WebGlSpiritField implements SpiritFieldRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #field: ProgramBundle;
  readonly #fullscreenBuffer: WebGLBuffer;
  readonly #fullscreenVao: WebGLVertexArrayObject;
  readonly #gl: WebGL2RenderingContext;
  readonly #particle: ProgramBundle;
  readonly #particleBuffer: WebGLBuffer;
  readonly #particleCount: number;
  readonly #particleVao: WebGLVertexArrayObject;
  readonly #pixelRatioLimit: number;
  readonly #ribbon: ProgramBundle;
  readonly #ribbonBuffer: WebGLBuffer;
  readonly #ribbonVertexCount: number;
  readonly #ribbonVao: WebGLVertexArrayObject;
  #height = 0;
  #pixelRatio = 1;
  #width = 0;

  constructor(
    gl: WebGL2RenderingContext,
    canvas: HTMLCanvasElement,
    options: SpiritFieldOptions,
  ) {
    this.#canvas = canvas;
    this.#gl = gl;
    this.#pixelRatioLimit = options.lowPower ? 1.25 : 1.5;
    this.#field = createProgramBundle(
      gl,
      FULLSCREEN_VERTEX_SHADER,
      FIELD_FRAGMENT_SHADER,
    );
    this.#ribbon = createProgramBundle(
      gl,
      RIBBON_VERTEX_SHADER,
      RIBBON_FRAGMENT_SHADER,
    );
    this.#particle = createProgramBundle(
      gl,
      PARTICLE_VERTEX_SHADER,
      PARTICLE_FRAGMENT_SHADER,
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

    const ribbonData = createRibbonGeometry(6, 84);
    this.#ribbonVertexCount = ribbonData.length / 3;
    this.#ribbonVao = requireResource(gl.createVertexArray());
    this.#ribbonBuffer = requireResource(gl.createBuffer());
    gl.bindVertexArray(this.#ribbonVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#ribbonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ribbonData, gl.STATIC_DRAW);
    enableAttribute(gl, this.#ribbon, "a_ribbon", 3, 12, 0);

    this.#particleCount = options.reducedMotion
      ? 120
      : options.lowPower
        ? 620
        : 900;
    const particleData = createParticleData(this.#particleCount);
    this.#particleVao = requireResource(gl.createVertexArray());
    this.#particleBuffer = requireResource(gl.createBuffer());
    gl.bindVertexArray(this.#particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particleData, gl.STATIC_DRAW);
    enableAttribute(gl, this.#particle, "a_particle", 4, 24, 0);
    enableAttribute(gl, this.#particle, "a_particle_extra", 2, 24, 16);
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
    this.#canvas.width = Math.round(width * pixelRatio);
    this.#canvas.height = Math.round(height * pixelRatio);
  }

  render(frame: SpiritFieldFrame): void {
    const gl = this.#gl;
    const build = clamp(frame.buildProgress);
    const reveal = easeOutCubic(clamp(frame.revealProgress));
    const time = frame.elapsedMs / 1_000;
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.#field.program);
    setUniform1f(gl, this.#field, "u_build", build);
    setUniform3f(gl, this.#field, "u_color", frame.color);
    setUniform1f(gl, this.#field, "u_reveal", reveal);
    setUniform1f(gl, this.#field, "u_time", time);
    gl.bindVertexArray(this.#fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.#ribbon.program);
    setUniform1f(gl, this.#ribbon, "u_alpha", 0.38 + build * 0.62);
    setUniform1f(gl, this.#ribbon, "u_build", build);
    setUniform3f(gl, this.#ribbon, "u_color", frame.color);
    setUniform1f(gl, this.#ribbon, "u_reveal", reveal);
    setUniform1f(gl, this.#ribbon, "u_time", time);
    gl.bindVertexArray(this.#ribbonVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.#ribbonVertexCount);

    gl.useProgram(this.#particle.program);
    setUniform1f(gl, this.#particle, "u_build", build);
    setUniform3f(gl, this.#particle, "u_color", frame.color);
    setUniform1f(gl, this.#particle, "u_pixel_ratio", this.#pixelRatio);
    setUniform1f(gl, this.#particle, "u_reveal", reveal);
    setUniform1f(gl, this.#particle, "u_time", time);
    gl.bindVertexArray(this.#particleVao);
    gl.drawArrays(gl.POINTS, 0, this.#particleCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.#gl;
    gl.deleteBuffer(this.#fullscreenBuffer);
    gl.deleteBuffer(this.#particleBuffer);
    gl.deleteBuffer(this.#ribbonBuffer);
    gl.deleteVertexArray(this.#fullscreenVao);
    gl.deleteVertexArray(this.#particleVao);
    gl.deleteVertexArray(this.#ribbonVao);
    gl.deleteProgram(this.#field.program);
    gl.deleteProgram(this.#particle.program);
    gl.deleteProgram(this.#ribbon.program);
  }
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
    if (location < 0) throw new Error(`Missing WebGL attribute: ${name}`);
    bundle.attributes.set(name, location);
  }
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
}

function getUniform(
  gl: WebGL2RenderingContext,
  bundle: ProgramBundle,
  name: string,
): WebGLUniformLocation {
  const cached = bundle.uniforms.get(name);
  if (cached) return cached;
  const location = gl.getUniformLocation(bundle.program, name);
  if (!location) throw new Error(`Missing WebGL uniform: ${name}`);
  bundle.uniforms.set(name, location);
  return location;
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
  value: SpiritFieldColor,
): void {
  gl.uniform3f(getUniform(gl, bundle, name), value[0], value[1], value[2]);
}

function createRibbonGeometry(
  pathCount: number,
  segments: number,
): Float32Array {
  const values: number[] = [];
  for (let path = 0; path < pathCount; path += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const start = segment / segments;
      const end = (segment + 1) / segments;
      values.push(
        start,
        -1,
        path,
        start,
        1,
        path,
        end,
        -1,
        path,
        end,
        -1,
        path,
        start,
        1,
        path,
        end,
        1,
        path,
      );
    }
  }
  return new Float32Array(values);
}

function createParticleData(count: number): Float32Array {
  const random = seededRandom(0x6d2b79f5);
  const values = new Float32Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 6;
    values[offset] = random();
    values[offset + 1] = index % 6;
    values[offset + 2] = (random() * 2 - 1) * mix(0.18, 1, random());
    values[offset + 3] = random();
    values[offset + 4] = Math.pow(random(), 2.2);
    values[offset + 5] = 0.68 + random() * 1.02;
  }
  return values;
}

function createCanvasFallback(
  canvas: HTMLCanvasElement,
  options: SpiritFieldOptions,
): SpiritFieldRenderer {
  const context = canvas.getContext("2d");
  if (!context) return createNoopRenderer();
  const particleCount = options.reducedMotion
    ? 48
    : options.lowPower
      ? 200
      : 260;
  const particles = Array.from({ length: particleCount }, (_, index) => ({
    lateral: ((index * 37) % 101) / 100 - 0.5,
    path: index % 6,
    phase: ((index * 67) % 251) / 251,
    size: 0.7 + ((index * 29) % 17) / 8,
    speed: 0.72 + ((index * 43) % 31) / 34,
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
        options.lowPower ? 1 : 1.25,
      );
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
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const centerX = width * 0.5;
      const centerY = height * 0.515;
      const cleanplate = context.createRadialGradient(
        centerX,
        centerY,
        width * 0.05,
        centerX,
        centerY,
        width * 0.64,
      );
      cleanplate.addColorStop(0, "rgba(5, 16, 26, 0.97)");
      cleanplate.addColorStop(0.68, "rgba(8, 25, 38, 0.9)");
      cleanplate.addColorStop(1, "rgba(8, 25, 38, 0)");
      context.fillStyle = cleanplate;
      context.fillRect(0, centerY - width * 0.72, width, width * 1.44);

      context.save();
      context.globalCompositeOperation = "lighter";
      for (let path = 0; path < 6; path += 1) {
        for (let fiber = 0; fiber < 6; fiber += 1) {
          context.beginPath();
          for (let step = 0; step <= 64; step += 1) {
            const t = step / 64;
            const point = fallbackCurve(
              t,
              path,
              build,
              reveal,
              time,
              width,
              height,
            );
            const wobble =
              Math.sin(t * 42 + fiber * 2.3 + path) * width * 0.006;
            if (step === 0) context.moveTo(point.x + wobble, point.y);
            else context.lineTo(point.x + wobble, point.y);
          }
          context.lineWidth = width * (0.005 + fiber * 0.003);
          context.strokeStyle = `rgba(255, ${232 + fiber * 5}, ${188 + fiber * 13}, ${(0.07 + fiber * 0.025) * (0.35 + build * 0.65) * (1 - reveal * 0.6)})`;
          context.stroke();
        }
      }

      particles.forEach((particle) => {
        const t = (particle.phase + time * 0.032 * particle.speed) % 1;
        const point = fallbackCurve(
          t,
          particle.path,
          build,
          reveal,
          time,
          width,
          height,
        );
        const radius = particle.size * (1 + reveal * 1.4);
        context.fillStyle = `rgba(255, 211, 122, ${(0.2 + build * 0.65) * (1 - reveal * 0.82)})`;
        context.beginPath();
        context.arc(
          point.x + particle.lateral * width * 0.13,
          point.y,
          radius,
          0,
          Math.PI * 2,
        );
        context.fill();
      });
      context.restore();
    },
  };
}

function fallbackCurve(
  t: number,
  path: number,
  build: number,
  reveal: number,
  time: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const z = t * 2 - 1;
  const radial = Math.pow(Math.abs(z), 0.68);
  const phase = -1.7 + path * 0.58;
  const pathBias = (path - 2.5) / 2.5;
  const angle =
    z * 3.35 +
    phase +
    Math.sin(z * Math.PI) * 0.2 +
    build * 0.5 +
    time * (0.045 + path * 0.003);
  const lobe = 0.2 + radial * (0.36 + 0.024 * (path % 3));
  const release = (1.14 - build * 0.12) * (1 + reveal * (0.42 + radial * 0.98));
  return {
    x:
      width *
      (0.5 +
        (Math.sin(angle) * lobe * radial +
          Math.sin(z * 6.2 + phase * 1.7) * 0.045 * radial +
          pathBias * 0.028 * radial) *
          release),
    y:
      height *
      (0.515 -
        (z * 0.16 +
          Math.cos(angle) * (0.0375 + radial * 0.135) * radial +
          pathBias * 0.012 * radial) *
          release),
  };
}

function createNoopRenderer(): SpiritFieldRenderer {
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

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}
