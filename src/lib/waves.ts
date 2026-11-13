// The "voice waves" WebGL renderer, shared by the site (ShaderBackground.astro)
// and the demo video (video/stage). Rendering only: callers own the clock, the
// level and the pointer, so the same frame can be drawn live or on demand.
export const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
export const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_level;
uniform float u_offset;

const vec3 C1 = vec3(0.133, 0.827, 0.933); // #22d3ee
const vec3 C2 = vec3(0.388, 0.400, 0.945); // #6366f1
const vec3 C3 = vec3(0.659, 0.333, 0.969); // #a855f7

vec3 pal(float t) {
  // Triangle wave: cyan → violet → cyan, so colours never jump.
  t = abs(fract(t * 0.5) * 2.0 - 1.0);
  return t < 0.5 ? mix(C1, C2, t * 2.0) : mix(C2, C3, t * 2.0 - 1.0);
}
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float aspect = u_res.x / u_res.y;
  float t = u_time;
  float energy = 0.35 + clamp(u_level, 0.0, 1.0) * 0.9;
  vec2 m = (u_mouse - 0.5) * vec2(aspect, 1.0);

  vec3 bg = vec3(0.043, 0.051, 0.086); // #0b0d16, same as the page
  vec3 waves = vec3(0.0);

  // Waves
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float freq = 1.4 + fi * 0.55;
    float amp = (0.06 + 0.035 * fi) * energy * (0.65 + 0.35 * sin(t * 0.7 + fi * 2.1));
    float y = sin(p.x * freq + t * (0.35 + fi * 0.07) + fi * 1.7) * amp;
    y += (fbm(vec2(p.x * 1.3 + t * 0.2 + fi * 3.1, fi)) - 0.5) * 0.22 * energy;
    float dx = (p.x - m.x) * 1.8;
    y += m.y * 0.25 * exp(-dx * dx); // the pointer bends the waves
    y += u_offset; // vertical position of the waves
    float d = abs(p.y - y);
    float glow = 0.0018 / (d + 0.0025) * (1.0 - smoothstep(0.0, 0.25, d));
    waves += pal(fi * 0.18 + p.x * 0.08 + t * 0.03) * glow * (0.35 + 0.45 * energy);
  }

  // Fade the waves toward the left and right edges; tone map; flat background.
  waves *= 1.0 - smoothstep(0.25, 0.5, abs(p.x / aspect));
  waves = 1.0 - exp(-waves * 1.5);
  gl_FragColor = vec4(bg + waves * (1.0 - bg), 1.0);
}`;

export interface WavesFrame {
  /** Seconds; any monotonic clock. */
  time: number;
  /** Speech energy, 0..1. */
  level: number;
  /** Pointer position in 0..1 (y up); 0.5,0.5 is neutral. */
  mouseX?: number;
  mouseY?: number;
}

export interface Waves {
  /** Size of the drawing buffer in device pixels. */
  setSize(width: number, height: number): void;
  draw(frame: WavesFrame): void;
}

/** Returns null when WebGL or the shader is unavailable; show a fallback then. */
export function createWaves(
  canvas: HTMLCanvasElement,
  { offsetY = -0.3, preserveDrawingBuffer = false } = {},
): Waves | null {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer,
  });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  try {
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  } catch (err) {
    console.warn('waves disabled:', err);
    return null;
  }
  gl.useProgram(prog);

  // One triangle covering the viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uMouse = gl.getUniformLocation(prog, 'u_mouse');
  const uLevel = gl.getUniformLocation(prog, 'u_level');
  const uOffset = gl.getUniformLocation(prog, 'u_offset');

  return {
    setSize(width, height) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    draw({ time, level, mouseX = 0.5, mouseY = 0.5 }) {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, mouseX, mouseY);
      gl.uniform1f(uLevel, level);
      gl.uniform1f(uOffset, offsetY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
