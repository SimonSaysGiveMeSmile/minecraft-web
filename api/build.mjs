// POST /api/build  { prompt: string }  →  { name, ops }
//
// Compiles a free-text description into voxel ops via Claude.
// The client executes the ops with the same primitives as shapes.ts,
// so AI builds animate block-by-block exactly like procedural ones.
//
// Env:
//   ANTHROPIC_API_KEY    — key or gateway token (required; fail closed)
//   ANTHROPIC_BASE_URL   — optional gateway base
//   BUILD_MODEL          — default claude-sonnet-4-6
//   MAX_BUILDS_PER_DAY   — global daily cap, best-effort per instance (default 300)

const MODEL = process.env.BUILD_MODEL || 'claude-sonnet-4-6'
const DAILY_CAP = Number(process.env.MAX_BUILDS_PER_DAY) || 300

// best-effort metering (per warm instance — a hard KV-backed cap can come later)
let day = ''
let used = 0
const lastHit = new Map() // ip → ts, simple 1-req-per-5s-per-ip throttle

const SYSTEM = `You compile a short build description into voxel operations for a Minecraft-like game.

Coordinate system: y is up, ground is y=0 (build from y=0 upward). Center the
structure on x=0, z=0. The viewer looks at the NEGATIVE-z side — put the front
(door, face, bow) on -z. Keep |x| and |z| <= 40 and y <= 80.

Block palette (use the number): 0 grass(green) 1 sand(yellow/gold) 2 log(brown bark)
3 leaf(dark green) 4 dirt(brown) 5 stone(gray) 6 coal(black) 7 wood planks(warm brown)
8 diamond(blue) 9 quartz(white) 10 glass(transparent) 11 bedrock(dark gray).

Operations (JSON arrays, executed in order — later ops overwrite earlier blocks):
  ["box", x1,y1,z1, x2,y2,z2, t]        solid cuboid of block t
  ["frame", x1,z1, x2,z2, y1,y2, t]     4 vertical walls only (no top/bottom)
  ["sphere", cx,cy,cz, r, t]            solid sphere
  ["dome", cx,cy,cz, r, t]              top half of a sphere
  ["cyl", cx,cz, r, y1,y2, t]           solid vertical cylinder
  ["line", x1,y1,z1, x2,y2,z2, t]       1-block-thick line between two points
  ["set", x,y,z, t]                     single block
  ["clear", x1,y1,z1, x2,y2,z2]         remove blocks (hollow rooms, doors, windows)

Think about silhouette, proportion and material contrast. Hollow large volumes
with "clear" so interiors are walkable. Add detail passes (windows, trim, roof)
after the base masses. 30–150 ops is the sweet spot.

Respond with ONLY a JSON object, no markdown fences:
{"name": "<short name, 2-4 words>", "ops": [ ... ]}`

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return res.status(503).json({ error: 'not configured' }) // fail closed

  const prompt = String(req.body?.prompt ?? '').slice(0, 200).trim()
  if (!prompt) return res.status(400).json({ error: 'empty prompt' })

  // throttle + daily cap
  const today = new Date().toISOString().slice(0, 10)
  if (today !== day) { day = today; used = 0 }
  if (used >= DAILY_CAP) return res.status(429).json({ error: 'daily cap reached' })
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown'
  const now = Date.now()
  if (now - (lastHit.get(ip) || 0) < 5000) {
    return res.status(429).json({ error: 'one build every 5s' })
  }
  lastHit.set(ip, now)
  if (lastHit.size > 5000) lastHit.clear()
  used++

  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')
  try {
    const r = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Build: ${prompt}` }]
      })
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      console.error('upstream', r.status, detail.slice(0, 300))
      return res.status(502).json({ error: 'generation failed' })
    }
    const data = await r.json()
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    const out = JSON.parse(json)
    if (!Array.isArray(out.ops) || !out.ops.length) throw new Error('no ops')
    out.ops = out.ops.slice(0, 400)
    out.name = String(out.name || prompt).slice(0, 40)
    return res.status(200).json(out)
  } catch (err) {
    console.error('build error', err?.message)
    return res.status(502).json({ error: 'generation failed' })
  }
}
