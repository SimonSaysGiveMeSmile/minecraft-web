import { BlockType } from '../terrain'
import { Canvas, Build } from './shapes'

/**
 * AI build mode — sends the description to /api/build, which compiles it
 * into voxel ops via Claude. Ops run through the same Canvas as shapes.ts,
 * so AI builds animate block-by-block exactly like procedural ones.
 *
 * Returns null on any failure so the caller can fall back to the local
 * procedural generator (offline dev servers have no /api).
 */

const API = (import.meta as any).env?.VITE_BUILD_API || '/api/build'
const CACHE_KEY = 'wb-ai-cache-v1'
const TIMEOUT_MS = 30000

type Op = (string | number)[]

const LIM = 48 // |x|,|z| clamp
const TOP = 96 // y clamp
const MAX_VOXELS = 40000

const C = (n: unknown, lim: number) =>
  Math.max(-lim, Math.min(lim, Math.round(Number(n) || 0)))
const T = (n: unknown): BlockType => {
  const t = Math.round(Number(n) || 0)
  return (t >= 0 && t <= 11 ? t : BlockType.stone) as BlockType
}

function runOps(ops: Op[]): Build['voxels'] {
  const v = new Canvas()
  for (const op of ops) {
    if (!Array.isArray(op)) continue
    const [kind, ...a] = op
    switch (kind) {
      case 'box': {
        const [x1, y1, z1, x2, y2, z2] = [
          C(a[0], LIM), C(a[1], TOP), C(a[2], LIM),
          C(a[3], LIM), C(a[4], TOP), C(a[5], LIM)
        ]
        v.box(x1, Math.max(0, y1), z1, x2, Math.max(0, y2), z2, T(a[6]))
        break
      }
      case 'frame': {
        const [x1, z1, x2, z2] = [C(a[0], LIM), C(a[1], LIM), C(a[2], LIM), C(a[3], LIM)]
        const [y1, y2] = [Math.max(0, C(a[4], TOP)), Math.max(0, C(a[5], TOP))]
        const t = T(a[6])
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
          for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
            v.set(x, y, z1, t)
            v.set(x, y, z2, t)
          }
          for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
            v.set(x1, y, z, t)
            v.set(x2, y, z, t)
          }
        }
        break
      }
      case 'sphere':
      case 'dome': {
        const [cx, cy, cz, r] = [C(a[0], LIM), C(a[1], TOP), C(a[2], LIM), Math.min(24, Math.abs(C(a[3], 24)))]
        const t = T(a[4])
        const yMin = kind === 'dome' ? 0 : -r
        for (let x = -r; x <= r; x++)
          for (let y = yMin; y <= r; y++)
            for (let z = -r; z <= r; z++)
              if (x * x + y * y + z * z <= r * r + r * 0.5 && cy + y >= 0)
                v.set(cx + x, cy + y, cz + z, t)
        break
      }
      case 'cyl': {
        const [cx, cz, r] = [C(a[0], LIM), C(a[1], LIM), Math.min(24, Math.abs(C(a[2], 24)))]
        const [y1, y2] = [Math.max(0, C(a[3], TOP)), Math.max(0, C(a[4], TOP))]
        const t = T(a[5])
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
          for (let x = -r; x <= r; x++)
            for (let z = -r; z <= r; z++)
              if (x * x + z * z <= r * r + r * 0.5) v.set(cx + x, y, cz + z, t)
        break
      }
      case 'line': {
        const [x1, y1, z1, x2, y2, z2] = [
          C(a[0], LIM), C(a[1], TOP), C(a[2], LIM),
          C(a[3], LIM), C(a[4], TOP), C(a[5], LIM)
        ]
        const t = T(a[6])
        const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), Math.abs(z2 - z1), 1)
        for (let i = 0; i <= steps; i++) {
          const f = i / steps
          v.set(
            x1 + (x2 - x1) * f,
            Math.max(0, y1 + (y2 - y1) * f),
            z1 + (z2 - z1) * f,
            t
          )
        }
        break
      }
      case 'set':
        v.set(C(a[0], LIM), Math.max(0, C(a[1], TOP)), C(a[2], LIM), T(a[3]))
        break
      case 'clear': {
        const [x1, y1, z1, x2, y2, z2] = [
          C(a[0], LIM), C(a[1], TOP), C(a[2], LIM),
          C(a[3], LIM), C(a[4], TOP), C(a[5], LIM)
        ]
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
          for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
            for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) v.unset(x, y, z)
        break
      }
    }
    if (v.map.size > MAX_VOXELS) break
  }
  return v.list().slice(0, MAX_VOXELS)
}

function readCache(): Record<string, { name: string; ops: Op[] }> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

export function archive(): string[] {
  return Object.keys(readCache())
}

export default async function aiGenerate(description: string): Promise<Build | null> {
  const key = description.toLowerCase().trim()

  // archive: a prompt we've built before re-places instantly, no credits
  const cache = readCache()
  if (cache[key]) {
    return { name: cache[key].name, voxels: runOps(cache[key].ops) }
  }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: description }),
      signal: ctrl.signal
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const out = await res.json()
    if (!Array.isArray(out?.ops) || !out.ops.length) return null

    const voxels = runOps(out.ops)
    if (!voxels.length) return null

    try {
      const entries = Object.entries(cache)
      if (entries.length >= 40) delete cache[entries[0][0]] // keep it bounded
      cache[key] = { name: out.name, ops: out.ops }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {}

    return { name: out.name, voxels }
  } catch {
    return null
  }
}
