import * as THREE from 'three'
import Terrain, { BlockType } from '../terrain'
import Block from '../terrain/mesh/block'
import generate from '../builder/shapes'
import Mobs from '../mobs'

const REGION = 144 // one potential village per region
const HOUSE_DESCRIPTIONS = ['wooden house', 'house', 'small house', 'stone house']

/**
 * Villages — deterministically scattered across the world (one chance
 * per 144×144 region, always one near spawn). Generated as persistent
 * custom blocks the first time the player comes close: houses facing a
 * central well, dirt paths, a small farm, lamp posts and villagers.
 */
export default class Villages {
  constructor(
    terrain: Terrain,
    camera: THREE.PerspectiveCamera,
    mobs: Mobs
  ) {
    this.terrain = terrain
    this.camera = camera
    this.mobs = mobs
  }

  terrain: Terrain
  camera: THREE.PerspectiveCamera
  mobs: Mobs

  generated = new Set<string>()
  centers: THREE.Vector3[] = [] // generated village centers (for villagers)
  lastSeed = NaN
  checkTimer = 0
  villagerTimer = 0

  noiseGround = (x: number, z: number) => {
    const noise = this.terrain.noise
    return (
      30 +
      Math.floor(noise.get(x / noise.gap, z / noise.gap, noise.seed) * noise.amp)
    )
  }

  // deterministic pseudo-random in [0,1) per region
  hash = (rx: number, rz: number, salt: number) => {
    const noise = this.terrain.noise
    const v = noise.get(
      rx * 7.31 + salt * 3.17 + 0.137,
      rz * 9.17 + salt * 1.93 + 0.713,
      this.terrain.noise.seed * 3.7 + salt
    )
    return (v + 1) / 2
  }

  hasVillage = (rx: number, rz: number) => {
    if (rx === 0 && rz === 0) return true // always one near spawn
    return this.hash(rx, rz, 1) > 0.52
  }

  villageCenter = (rx: number, rz: number) => {
    const cx = rx * REGION + 40 + Math.floor(this.hash(rx, rz, 2) * (REGION - 80))
    const cz = rz * REGION + 40 + Math.floor(this.hash(rx, rz, 3) * (REGION - 80))
    return { cx, cz }
  }

  storageKey = () => `mc_villages_${this.terrain.noise.seed}`

  placeBlock = (x: number, y: number, z: number, type: BlockType) => {
    if (y <= 0) return
    for (const block of this.terrain.customBlocks) {
      if (block.x === x && block.y === y && block.z === z && block.placed) {
        return
      }
    }
    const capacity = Math.floor(
      this.terrain.maxCount * this.terrain.blocksFactor[type]
    )
    if (this.terrain.getCount(type) >= capacity - 1) return

    const matrix = new THREE.Matrix4()
    matrix.setPosition(x, y, z)
    this.terrain.blocks[type].setMatrixAt(this.terrain.getCount(type), matrix)
    this.terrain.setCount(type)
    this.terrain.blocks[type].instanceMatrix.needsUpdate = true
    this.terrain.customBlocks.push(new Block(x, y, z, type, true))
  }

  // swap the natural surface block of a column for another type (paths, farm)
  replaceSurface = (x: number, z: number, type: BlockType) => {
    const y = this.noiseGround(x, z)
    this.mobs.removeNaturalBlock(x, y, z)
    this.placeBlock(x, y, z, type)
    return y
  }

  // rotate builder voxels so their front (-z) faces direction (fx, fz)
  rotateVoxels = (
    voxels: { x: number; y: number; z: number; type: BlockType }[],
    fx: number,
    fz: number
  ) => {
    const dx = -fx
    const dz = -fz
    return voxels.map(v => {
      let x: number, z: number
      if (dz === 1) {
        x = v.x
        z = v.z
      } else if (dx === 1) {
        x = v.z
        z = -v.x
      } else if (dz === -1) {
        x = -v.x
        z = -v.z
      } else {
        x = -v.z
        z = v.x
      }
      return { x, y: v.y, z, type: v.type }
    })
  }

  buildHouse = (
    description: string,
    cx: number,
    cz: number,
    fx: number,
    fz: number
  ) => {
    const { voxels } = generate(description)
    const rotated = this.rotateVoxels(voxels as any, fx, fz)

    // foundation: rest on the highest column, fill below with dirt
    const columns = new Map<string, { x: number; z: number; ground: number }>()
    let baseY = 0
    let minGround = Infinity
    for (const v of rotated) {
      const x = v.x + cx
      const z = v.z + cz
      const key = `${x}_${z}`
      if (!columns.has(key)) {
        const ground = this.noiseGround(x, z)
        columns.set(key, { x, z, ground })
        baseY = Math.max(baseY, ground + 1)
        minGround = Math.min(minGround, ground)
      }
    }
    if (baseY - minGround > 6) return false // too steep, skip this lot

    for (const { x, z, ground } of columns.values()) {
      for (let y = ground + 1; y < baseY; y++) {
        this.placeBlock(x, y, z, BlockType.dirt)
      }
    }
    for (const v of rotated) {
      this.placeBlock(v.x + cx, v.y + baseY, v.z + cz, v.type)
    }
    return true
  }

  buildWell = (cx: number, cz: number) => {
    const g = this.noiseGround(cx, cz)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) {
          // "water"
          this.placeBlock(cx, g + 1, cz, BlockType.diamond)
        } else {
          this.placeBlock(cx + dx, g + 1, cz + dz, BlockType.stone)
        }
      }
    }
    // posts + roof
    for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      for (let y = 2; y <= 4; y++) {
        this.placeBlock(cx + dx, g + y, cz + dz, BlockType.stone)
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.placeBlock(cx + dx, g + 5, cz + dz, BlockType.stone)
      }
    }
  }

  buildPath = (cx: number, cz: number, fx: number, fz: number, length: number) => {
    for (let i = 2; i <= length; i++) {
      const x = cx + fx * i
      const z = cz + fz * i
      this.replaceSurface(x, z, BlockType.dirt)
      // 2 wide
      this.replaceSurface(x + Math.abs(fz), z + Math.abs(fx), BlockType.dirt)
    }
  }

  buildLamp = (x: number, z: number) => {
    const g = this.noiseGround(x, z)
    for (let y = 1; y <= 3; y++) {
      this.placeBlock(x, g + y, z, BlockType.tree)
    }
    this.placeBlock(x, g + 4, z, BlockType.quartz)
  }

  buildFarm = (cx: number, cz: number) => {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const x = cx + dx
        const z = cz + dz
        if (dz === 0) {
          // irrigation channel
          const y = this.noiseGround(x, z)
          this.mobs.removeNaturalBlock(x, y, z)
          this.placeBlock(x, y, z, BlockType.diamond)
        } else {
          const y = this.replaceSurface(x, z, BlockType.dirt)
          // crops
          this.placeBlock(x, y + 1, z, BlockType.leaf)
        }
      }
    }
    // log border corners
    for (const [dx, dz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
      const x = cx + dx
      const z = cz + dz
      this.placeBlock(x, this.noiseGround(x, z) + 1, z, BlockType.tree)
    }
  }

  generateVillage = (cx: number, cz: number) => {
    this.buildWell(cx, cz)

    // houses north / south / east / west of the well, facing it
    const lots: [number, number, number, number][] = [
      [cx + 14, cz, -1, 0],
      [cx - 14, cz, 1, 0],
      [cx, cz + 14, 0, -1],
      [cx, cz - 14, 0, 1]
    ]
    lots.forEach(([hx, hz, fx, fz], i) => {
      const built = this.buildHouse(
        HOUSE_DESCRIPTIONS[i % HOUSE_DESCRIPTIONS.length],
        hx,
        hz,
        fx,
        fz
      )
      if (built) {
        this.buildPath(cx, cz, -fx, -fz, 9)
        this.buildLamp(cx - fx * 7 + (fz !== 0 ? 2 : 0), cz - fz * 7 + (fx !== 0 ? 2 : 0))
      }
    })

    this.buildFarm(cx + 11, cz + 11)
    this.centers.push(new THREE.Vector3(cx, this.noiseGround(cx, cz), cz))
  }

  nearest = () => {
    // handy for debugging / teleporting: closest village center (any region)
    const px = this.camera.position.x
    const pz = this.camera.position.z
    const prx = Math.floor(px / REGION)
    const prz = Math.floor(pz / REGION)
    let best: { cx: number; cz: number; dist: number } | null = null
    for (let rx = prx - 2; rx <= prx + 2; rx++) {
      for (let rz = prz - 2; rz <= prz + 2; rz++) {
        if (!this.hasVillage(rx, rz)) continue
        const { cx, cz } = this.villageCenter(rx, rz)
        const dist = Math.hypot(cx - px, cz - pz)
        if (!best || dist < best.dist) best = { cx, cz, dist }
      }
    }
    return best
  }

  update = () => {
    // new world → reset
    if (this.terrain.noise.seed !== this.lastSeed) {
      this.lastSeed = this.terrain.noise.seed
      this.centers = []
      this.generated = new Set(
        JSON.parse(window.localStorage.getItem(this.storageKey()) || '[]')
      )
      // re-register centers of already-generated villages (loaded game)
      for (const key of this.generated) {
        const [rx, rz] = key.split('_').map(Number)
        const { cx, cz } = this.villageCenter(rx, rz)
        this.centers.push(new THREE.Vector3(cx, this.noiseGround(cx, cz), cz))
      }
    }

    if (this.checkTimer++ % 60 !== 0) return // ~1×/second

    const px = this.camera.position.x
    const pz = this.camera.position.z
    const prx = Math.floor(px / REGION)
    const prz = Math.floor(pz / REGION)

    for (let rx = prx - 1; rx <= prx + 1; rx++) {
      for (let rz = prz - 1; rz <= prz + 1; rz++) {
        const key = `${rx}_${rz}`
        if (this.generated.has(key) || !this.hasVillage(rx, rz)) continue
        const { cx, cz } = this.villageCenter(rx, rz)
        if (Math.hypot(cx - px, cz - pz) > 56) continue

        this.generateVillage(cx, cz)
        this.generated.add(key)
        window.localStorage.setItem(
          this.storageKey(),
          JSON.stringify([...this.generated])
        )
      }
    }

    // keep villages populated
    for (const center of this.centers) {
      if (center.distanceTo(this.camera.position) > 64) continue
      if (this.mobs.villagersNear(center, 26) < 3) {
        const angle = Math.random() * Math.PI * 2
        const d = 3 + Math.random() * 8
        this.mobs.spawnAt(
          'villager',
          Math.round(center.x + Math.cos(angle) * d),
          Math.round(center.z + Math.sin(angle) * d),
          center
        )
      }
    }
  }
}
