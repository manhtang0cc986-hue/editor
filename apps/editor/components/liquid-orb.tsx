'use client'

import { useEffect, useRef } from 'react'

export type LiquidOrbState = 'idle' | 'thinking'

type LiquidOrbProps = {
  state?: LiquidOrbState
  size?: number
  className?: string
}

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

// Ported from the Metal LiquidOrbView shader (idle / thinking liquid glass orb).
const FRAGMENT_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_thinking;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  float r = length(uv);
  if (r > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float t = u_time * mix(0.66, 2.2, u_thinking);
  float depth = sqrt(max(1.0 - r * r, 0.0));
  vec2 p = uv / (0.72 + 0.28 * depth);

  // Domain-warped liquid flow
  vec2 w = vec2(
    fbm(p * 1.4 + vec2(t * 0.14, -t * 0.09)),
    fbm(p * 1.4 + vec2(-t * 0.11, t * 0.16) + 5.2)
  );
  vec2 q = p + (w - 0.5) * mix(0.55, 0.95, u_thinking);
  float f = fbm(q * mix(1.6, 2.3, u_thinking) + vec2(t * 0.08, -t * 0.06));
  float ridge = pow(1.0 - abs(f * 2.0 - 1.0), mix(1.8, 3.2, u_thinking));

  // Idle palette vs Thinking palette (from orbIdleUniformSeed / orbThinkingUniformSeed)
  vec3 idleA = vec3(0.008, 0.020, 0.047);
  vec3 idleB = vec3(0.114, 0.400, 0.349);
  vec3 idleC = vec3(0.157, 0.365, 0.471);
  vec3 idleD = vec3(0.325, 0.243, 0.459);

  vec3 thinkA = vec3(0.012, 0.031, 0.086);
  vec3 thinkB = vec3(0.125, 0.941, 0.714);
  vec3 thinkC = vec3(0.196, 0.659, 1.000);
  vec3 thinkD = vec3(0.639, 0.294, 1.000);

  vec3 cA = mix(idleA, thinkA, u_thinking);
  vec3 cB = mix(idleB, thinkB, u_thinking);
  vec3 cC = mix(idleC, thinkC, u_thinking);
  vec3 cD = mix(idleD, thinkD, u_thinking);

  float tone = clamp(f * 0.65 + ridge * 0.55, 0.0, 1.0);
  vec3 col = mix(cA, cB, smoothstep(0.0, 0.42, tone));
  col = mix(col, cC, smoothstep(0.35, 0.72, tone));
  col = mix(col, cD, smoothstep(0.66, 1.0, tone));

  // Glass rim & Fresnel specular highlight
  float fresnel = pow(1.0 - depth, 2.6);
  vec3 rimColor = mix(vec3(0.196, 0.659, 1.0), vec3(0.55, 0.92, 1.0), u_thinking);
  col += rimColor * fresnel * mix(0.45, 0.75, u_thinking);

  vec2 n2 = normalize(uv + 1e-4);
  float spec = pow(max(dot(n2, normalize(vec2(-0.65, 0.75))), 0.0), 4.0) * fresnel;
  col += vec3(0.92, 0.96, 1.0) * spec * 0.85;

  float alpha = 1.0 - smoothstep(0.94, 1.0, r);
  gl_FragColor = vec4(col * alpha, alpha);
}
`

export function LiquidOrb({ state = 'idle', size = 36, className = '' }: LiquidOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetThinkingRef = useRef(state === 'thinking' ? 1 : 0)

  useEffect(() => {
    targetThinkingRef.current = state === 'thinking' ? 1 : 0
  }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true })
    if (!gl) return

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return shader
    }

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!vs || !fs || !program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.useProgram(program)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    const posLoc = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const uTime = gl.getUniformLocation(program, 'u_time')
    const uThinking = gl.getUniformLocation(program, 'u_thinking')

    let currentThinking = targetThinkingRef.current
    let raf = 0
    const start = performance.now()

    const render = (now: number) => {
      const target = targetThinkingRef.current
      currentThinking += (target - currentThinking) * 0.08
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(uTime, (now - start) / 1000)
      gl.uniform1f(uThinking, currentThinking)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      raf = requestAnimationFrame(render)
    }

    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [])

  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 2

  return (
    <canvas
      ref={canvasRef}
      width={size * dpr}
      height={size * dpr}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full bg-gradient-to-br from-cyan-400/20 via-sky-500/20 to-violet-500/20 ${className}`}
    />
  )
}
