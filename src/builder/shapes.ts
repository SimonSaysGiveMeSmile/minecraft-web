import { BlockType } from '../terrain'
import { textToBitmap } from './font'

export interface Voxel {
  x: number
  y: number
  z: number
  type: BlockType
}

export interface Build {
  name: string
  voxels: Voxel[]
}

const R = Math.round

/**
 * Voxel canvas with de-duplication (later writes win, so details
 * like windows / eyes can overwrite base shapes).
 */
class Canvas {
  map = new Map<string, Voxel>()

  set(x: number, y: number, z: number, type: BlockType) {
    x = R(x)
    y = R(y)
    z = R(z)
    if (y < 0) return
    this.map.set(`${x}_${y}_${z}`, { x, y, z, type })
  }

  unset(x: number, y: number, z: number) {
    this.map.delete(`${R(x)}_${R(y)}_${R(z)}`)
  }

  box(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    type: BlockType
  ) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
          this.set(x, y, z, type)
        }
      }
    }
  }

  // vertical walls of a rectangle footprint (no roof / floor)
  walls(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    y1: number,
    y2: number,
    type: BlockType
  ) {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        this.set(x, y, z1, type)
        this.set(x, y, z2, type)
      }
      for (let z = z1; z <= z2; z++) {
        this.set(x1, y, z, type)
        this.set(x2, y, z, type)
      }
    }
  }

  // battlements along the top edge of a rectangle footprint
  crenellate(x1: number, z1: number, x2: number, z2: number, y: number, type: BlockType) {
    for (let x = x1; x <= x2; x++) {
      if ((x - x1) % 2 === 0) {
        this.set(x, y, z1, type)
        this.set(x, y, z2, type)
      }
    }
    for (let z = z1; z <= z2; z++) {
      if ((z - z1) % 2 === 0) {
        this.set(x1, y, z, type)
        this.set(x2, y, z, type)
      }
    }
  }

  sphere(
    cx: number,
    cy: number,
    cz: number,
    r: number,
    type: BlockType,
    hollow = false
  ) {
    for (let x = -r; x <= r; x++) {
      for (let y = -r; y <= r; y++) {
        for (let z = -r; z <= r; z++) {
          const d = Math.sqrt(x * x + y * y + z * z)
          if (d <= r + 0.3 && (!hollow || d >= r - 0.7)) {
            this.set(cx + x, cy + y, cz + z, type)
          }
        }
      }
    }
  }

  cylinder(
    cx: number,
    cz: number,
    y1: number,
    y2: number,
    r: number,
    type: BlockType,
    hollow = false
  ) {
    for (let y = y1; y <= y2; y++) {
      this.ring(cx, cz, y, r, type, hollow)
    }
  }

  // filled disk or ring at a single y level
  ring(cx: number, cz: number, y: number, r: number, type: BlockType, hollow = false) {
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        const d = Math.sqrt(x * x + z * z)
        if (d <= r + 0.3 && (!hollow || d >= r - 0.7)) {
          this.set(cx + x, y, cz + z, type)
        }
      }
    }
  }

  /**
   * Extrude a bitmap ('#' = block) standing upright in the z=0..depth-1
   * plane, bottom row at y=yBase, centered on x. Mirrored on x so text
   * reads correctly for a viewer the structure is facing (-z side).
   */
  bitmap(
    rows: string[],
    type: BlockType,
    yBase = 0,
    scale = 1,
    depth = 1
  ) {
    if (!rows.length) return
    const w = Math.max(...rows.map(r => r.length))
    const xOff = -R((w * scale) / 2)
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== '#') continue
        const px = (w - 1 - c) * scale + xOff
        const py = (rows.length - 1 - r) * scale + yBase
        for (let sx = 0; sx < scale; sx++) {
          for (let sy = 0; sy < scale; sy++) {
            for (let d = 0; d < depth; d++) {
              this.set(px + sx, py + sy, d, type)
            }
          }
        }
      }
    }
  }

  list() {
    return [...this.map.values()]
  }
}

type ShapeFn = (s: number, mat?: BlockType) => Canvas

// ---------------------------------------------------------------------------
// shapes — all centered on (0, *, 0), base at y=0, front facing -z
// ---------------------------------------------------------------------------

const house: ShapeFn = (s, mat = BlockType.wood) => {
  const v = new Canvas()
  const hw = R(3 * s) + 1
  const hd = R(4 * s) + 1
  const h = Math.max(3, R(4 * s))

  v.box(-hw, 0, -hd, hw, 0, hd, BlockType.wood) // floor
  v.walls(-hw, -hd, hw, hd, 1, h, mat)

  // log corner posts
  for (const x of [-hw, hw]) {
    for (const z of [-hd, hd]) {
      v.box(x, 1, z, x, h, z, BlockType.tree)
    }
  }

  // glass windows on the side walls
  for (let z = -hd + 2; z <= hd - 2; z += 2) {
    v.set(-hw, R(h / 2) + 1, z, BlockType.glass)
    v.set(hw, R(h / 2) + 1, z, BlockType.glass)
  }

  // door opening on the front wall
  v.unset(0, 1, -hd)
  v.unset(0, 2, -hd)

  // pitched roof (log), sloping along x
  for (let i = 0; ; i++) {
    const x1 = -hw - 1 + i
    const x2 = hw + 1 - i
    if (x1 > x2) break
    v.box(x1, h + 1 + i, -hd - 1, x2, h + 1 + i, hd + 1, BlockType.tree)
    if (x1 === x2 || x1 + 1 === x2) break
  }
  return v
}

const castle: ShapeFn = (s, mat = BlockType.stone) => {
  const v = new Canvas()
  const hw = R(7 * s) + 1
  const h = Math.max(4, R(6 * s))

  v.walls(-hw, -hw, hw, hw, 1, h, mat)
  v.crenellate(-hw, -hw, hw, hw, h + 1, mat)

  // corner towers
  for (const x of [-hw, hw]) {
    for (const z of [-hw, hw]) {
      v.cylinder(x, z, 0, h + 2, 2, mat)
      v.ring(x, z, h + 3, 2, mat, true)
    }
  }

  // central keep
  const k = Math.max(2, R(3 * s))
  v.walls(-k, -k, k, k, 1, h + 2, mat)
  v.box(-k, h + 3, -k, k, h + 3, k, mat)
  v.crenellate(-k, -k, k, k, h + 4, mat)

  // front gate
  for (let x = -1; x <= 1; x++) {
    for (let y = 1; y <= 3; y++) {
      v.unset(x, y, -hw)
    }
  }
  return v
}

const tower: ShapeFn = (s, mat = BlockType.stone) => {
  const v = new Canvas()
  const r = Math.max(2, R(3 * s))
  const h = Math.max(6, R(12 * s))
  v.cylinder(0, 0, 0, h, r, mat, true)
  v.ring(0, 0, h, r, mat) // top floor
  v.ring(0, 0, h + 1, r, mat, true)
  v.crenellate(-r, -r, r, r, h + 1, mat)
  // doorway
  v.unset(0, 1, -r)
  v.unset(0, 2, -r)
  return v
}

const pyramid: ShapeFn = (s, mat = BlockType.sand) => {
  const v = new Canvas()
  const half = R(5.5 * s) + 1
  for (let i = 0; half - i >= 0; i++) {
    const k = half - i
    if (k === 0) {
      v.set(0, i, 0, mat)
    } else {
      v.walls(-k, -k, k, k, i, i, mat)
    }
  }
  return v
}

const bigTree: ShapeFn = s => {
  const v = new Canvas()
  const h = Math.max(5, R(8 * s))
  const r = Math.max(3, R(4 * s))
  v.box(0, 0, 0, 0, h, 0, BlockType.tree)
  if (s >= 1.5) v.box(-1, 0, -1, 0, h, 0, BlockType.tree) // thick trunk
  v.sphere(0, h + r - 1, 0, r, BlockType.leaf)
  return v
}

const bridge: ShapeFn = (s, mat = BlockType.wood) => {
  const v = new Canvas()
  const hl = R(7 * s) + 1
  const h = Math.max(3, R(4 * s))
  v.box(-hl, h, -1, hl, h, 1, mat) // deck
  for (let x = -hl; x <= hl; x += 2) {
    v.set(x, h + 1, -1, mat) // railings
    v.set(x, h + 1, 1, mat)
  }
  for (const x of [-hl, 0, hl]) {
    v.box(x, 0, -1, x, h - 1, -1, BlockType.stone) // pillars
    v.box(x, 0, 1, x, h - 1, 1, BlockType.stone)
  }
  return v
}

const ship: ShapeFn = (s, mat = BlockType.wood) => {
  const v = new Canvas()
  const hl = R(7 * s) + 1
  const hw = Math.max(2, R(2.5 * s))
  // hull: tapered at bow and stern
  for (let x = -hl; x <= hl; x++) {
    const taper = Math.max(0, Math.abs(x) - (hl - 2))
    const w = Math.max(0, hw - taper)
    v.box(x, 1, -w, x, 1, w, mat) // sides
    if (w > 0) v.walls(x, -w, x, w, 2, 2, mat)
    v.box(x, 0, -Math.max(0, w - 1), x, 0, Math.max(0, w - 1), mat) // bottom
    v.box(x, 2, -w, x, 2, w, mat) // deck
  }
  // mast and sail
  const mastH = Math.max(5, R(7 * s))
  v.box(0, 3, 0, 0, 3 + mastH, 0, BlockType.tree)
  for (let z = -hw; z <= hw; z++) {
    if (z === 0) continue
    v.box(0, 5, z, 0, 2 + mastH, z, BlockType.quartz)
  }
  // small cabin at the stern
  v.box(hl - 3, 3, -1, hl - 1, 4, 1, BlockType.tree)
  return v
}

const wall: ShapeFn = (s, mat = BlockType.stone) => {
  const v = new Canvas()
  const hl = R(5.5 * s) + 1
  const h = Math.max(3, R(4 * s))
  v.box(-hl, 0, 0, hl, h, 0, mat)
  for (let x = -hl; x <= hl; x += 2) {
    v.set(x, h + 1, 0, mat)
  }
  return v
}

const ball: ShapeFn = (s, mat = BlockType.glass) => {
  const v = new Canvas()
  const r = Math.max(2, R(4 * s))
  v.sphere(0, r, 0, r, mat, true)
  return v
}

const cube: ShapeFn = (s, mat = BlockType.stone) => {
  const v = new Canvas()
  const a = Math.max(2, R(2.5 * s))
  v.box(-a, 0, -a, a, 2 * a, a, mat)
  return v
}

const arch: ShapeFn = (s, mat = BlockType.stone) => {
  const v = new Canvas()
  const r = Math.max(4, R(5 * s))
  for (let a = 0; a <= Math.PI + 0.01; a += 0.05) {
    for (const rr of [r, r - 1]) {
      for (let z = 0; z <= 1; z++) {
        v.set(R(rr * Math.cos(a)), R(rr * Math.sin(a)), z, mat)
      }
    }
  }
  return v
}

const statue: ShapeFn = (s, mat = BlockType.quartz) => {
  const v = new Canvas()
  const legH = Math.max(2, R(3 * s))
  const torH = Math.max(2, R(3 * s))
  const top = legH + torH
  v.box(-1, 0, 0, 0, legH - 1, 0, mat) // legs
  v.box(-1, legH, 0, 0, top - 1, 0, mat) // torso
  v.box(-2, legH + 1, 0, -2, top - 1, 0, mat) // arms
  v.box(1, legH + 1, 0, 1, top - 1, 0, mat)
  v.box(-1, top, 0, 0, top + 1, 0, mat) // head
  for (const x of [-1, 0]) v.set(x, top + 1, -1, BlockType.coal) // eyes... ish
  return v
}

const heart: ShapeFn = (s, mat = BlockType.diamond) => {
  const v = new Canvas()
  v.bitmap(
    [
      '.##...##.',
      '####.####',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
      '...###...',
      '....#....'
    ],
    mat,
    0,
    Math.max(1, R(s)),
    2
  )
  return v
}

const star: ShapeFn = (s, mat = BlockType.sand) => {
  const v = new Canvas()
  v.bitmap(
    [
      '....#....',
      '....#....',
      '...###...',
      '#########',
      '.#######.',
      '..#####..',
      '..#...#..',
      '.#.....#.'
    ],
    mat,
    0,
    Math.max(1, R(s)),
    2
  )
  return v
}

const smiley: ShapeFn = (s, mat = BlockType.sand) => {
  const v = new Canvas()
  const scale = Math.max(1, R(s))
  v.bitmap(
    [
      '...#####...',
      '..#######..',
      '.#########.',
      '###########',
      '###.###.###',
      '###.###.###',
      '###########',
      '##.#####.##',
      '.##.###.##.',
      '..##...##..',
      '...#####...'
    ],
    mat,
    0,
    scale,
    2
  )
  // punch the eyes / mouth through with coal
  v.bitmap(
    [
      '...........',
      '...........',
      '...........',
      '...........',
      '...#...#...',
      '...#...#...',
      '...........',
      '..#.....#..',
      '...#####...',
      '...........',
      '...........'
    ],
    BlockType.coal,
    0,
    scale,
    2
  )
  return v
}

const rainbow: ShapeFn = s => {
  const v = new Canvas()
  const r = Math.max(6, R(9 * s))
  const bands = [BlockType.diamond, BlockType.leaf, BlockType.sand, BlockType.quartz]
  for (let b = 0; b < bands.length; b++) {
    for (let a = 0; a <= Math.PI + 0.01; a += 0.03) {
      for (let z = 0; z <= 1; z++) {
        v.set(R((r - b) * Math.cos(a)), R((r - b) * Math.sin(a)), z, bands[b])
      }
    }
  }
  return v
}

const pillar: ShapeFn = (s, mat = BlockType.quartz) => {
  const v = new Canvas()
  const h = Math.max(5, R(8 * s))
  v.box(-1, 0, -1, 1, 0, 1, mat)
  v.box(0, 1, 0, 0, h - 1, 0, mat)
  v.box(-1, h, -1, 1, h, 1, mat)
  return v
}

const fountain: ShapeFn = (s, mat = BlockType.stone) => {
  const v = new Canvas()
  const r = Math.max(3, R(4 * s))
  v.ring(0, 0, 0, r, mat)
  v.ring(0, 0, 1, r, mat, true)
  v.ring(0, 0, 1, r - 1, BlockType.glass) // "water"
  const h = Math.max(2, R(3 * s))
  v.box(0, 1, 0, 0, h, 0, mat)
  v.sphere(0, h + 1, 0, 1, BlockType.glass)
  return v
}

const igloo: ShapeFn = (s, mat = BlockType.quartz) => {
  const v = new Canvas()
  const r = Math.max(3, R(4 * s))
  v.sphere(0, 0, 0, r, mat, true) // bottom half is clipped at y<0
  // entrance
  for (let y = 0; y <= 1; y++) {
    for (let z = -r - 1; z <= -r + 2; z++) {
      v.unset(0, y, z)
      v.set(-1, y, z, mat)
      v.set(1, y, z, mat)
    }
    v.unset(0, y, -r)
  }
  for (let z = -r - 1; z <= -r + 2; z++) v.set(0, 2, z, mat)
  return v
}

const snowman: ShapeFn = (s, mat = BlockType.quartz) => {
  const v = new Canvas()
  const r1 = Math.max(2, R(3 * s))
  const r2 = Math.max(2, R(2.2 * s))
  const r3 = Math.max(1, R(1.5 * s))
  const cy2 = 2 * r1 + r2 - 1
  const cy3 = cy2 + r2 + r3
  v.sphere(0, r1, 0, r1, mat)
  v.sphere(0, cy2, 0, r2, mat)
  v.sphere(0, cy3, 0, r3, mat)
  v.set(-1, cy3 + 1, -r3, BlockType.coal) // eyes
  v.set(1, cy3 + 1, -r3, BlockType.coal)
  for (let i = 0; i < 2; i++) v.set(0, cy2 + i, -r2, BlockType.coal) // buttons
  return v
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

const MATERIALS: [RegExp, BlockType][] = [
  [/\b(stone|rock|brick|cobble\w*)\b/, BlockType.stone],
  [/\b(wood|wooden|plank\w*)\b/, BlockType.wood],
  [/\b(log|oak|bark)\b/, BlockType.tree],
  [/\b(glass|crystal|ice)\b/, BlockType.glass],
  [/\b(diamond|gem|blue)\b/, BlockType.diamond],
  [/\b(quartz|marble|snow|white)\b/, BlockType.quartz],
  [/\b(sand|sandstone|gold\w*|yellow)\b/, BlockType.sand],
  [/\b(dirt|mud|brown)\b/, BlockType.dirt],
  [/\b(grass|green)\b/, BlockType.grass],
  [/\b(leaf|leaves|hedge)\b/, BlockType.leaf],
  [/\b(coal|black|dark)\b/, BlockType.coal],
  [/\b(bedrock|obsidian|gray|grey)\b/, BlockType.bedrock]
]

const SIZES: [RegExp, number][] = [
  [/\b(tiny|mini)\b/, 0.5],
  [/\b(small|little)\b/, 0.75],
  [/\b(big|large|tall|grand)\b/, 1.5],
  [/\b(huge|giant|mega)\b/, 2],
  [/\b(massive|colossal|enormous|gigantic)\b/, 2.5]
]

const SHAPES: { match: RegExp; name: string; build: ShapeFn }[] = [
  { match: /\b(house|home|hut|cabin|cottage|shack|mansion)\b/, name: 'house', build: house },
  { match: /\b(castle|fort|fortress|palace|keep)\b/, name: 'castle', build: castle },
  { match: /\b(tower|lighthouse|spire|turret|skyscraper)\b/, name: 'tower', build: tower },
  { match: /\b(pyramid)\b/, name: 'pyramid', build: pyramid },
  { match: /\b(tree)\b/, name: 'tree', build: bigTree },
  { match: /\b(bridge)\b/, name: 'bridge', build: bridge },
  { match: /\b(ship|boat|sailboat|yacht)\b/, name: 'ship', build: ship },
  { match: /\b(wall|fence)\b/, name: 'wall', build: wall },
  { match: /\b(sphere|ball|orb|globe|planet|moon)\b/, name: 'sphere', build: ball },
  { match: /\b(cube|box)\b/, name: 'cube', build: cube },
  { match: /\b(arch|gateway|portal)\b/, name: 'arch', build: arch },
  { match: /\b(statue|golem|robot|person|man|human|steve)\b/, name: 'statue', build: statue },
  { match: /\b(heart|love)\b/, name: 'heart', build: heart },
  { match: /\b(star)\b/, name: 'star', build: star },
  { match: /\b(smiley|smile|face|emoji)\b/, name: 'smiley', build: smiley },
  { match: /\b(rainbow)\b/, name: 'rainbow', build: rainbow },
  { match: /\b(pillar|column|obelisk)\b/, name: 'pillar', build: pillar },
  { match: /\b(fountain|well)\b/, name: 'fountain', build: fountain },
  { match: /\b(igloo|dome)\b/, name: 'igloo', build: igloo },
  { match: /\b(snowman)\b/, name: 'snowman', build: snowman }
]

const FILLER =
  /\b(a|an|the|of|in|on|with|and|or|please|build|make|made|create|generate|me|my|some|very)\b/g

/**
 * Turn a free-text description into a named voxel build.
 * Falls back to spelling the words out in giant block letters.
 */
export default function generate(description: string): Build {
  const lower = description.toLowerCase()

  let mat: BlockType | undefined
  for (const [re, type] of MATERIALS) {
    if (re.test(lower)) {
      mat = type
      break
    }
  }

  let size = 1
  for (const [re, value] of SIZES) {
    if (re.test(lower)) {
      size = value
      break
    }
  }

  const forceText = /\b(write|text|say|sign|spell)\b/.test(lower)

  if (!forceText) {
    for (const shape of SHAPES) {
      if (shape.match.test(lower)) {
        return { name: shape.name, voxels: shape.build(size, mat).list() }
      }
    }
  }

  // fallback: build the words themselves in block letters
  let text = lower
    .replace(/\b(write|text|say|sign|spell)\b/g, '')
    .replace(FILLER, '')
  for (const [re] of SIZES) text = text.replace(re, '')
  text = text.replace(/[^a-z0-9!?.\- ]/g, '').replace(/\s+/g, ' ').trim()
  if (!text) text = 'hi'
  text = text.slice(0, 10).trim()

  const v = new Canvas()
  v.bitmap(textToBitmap(text), mat ?? BlockType.quartz, 0, Math.max(1, R(size)), 1)
  return { name: `"${text.toUpperCase()}"`, voxels: v.list() }
}
