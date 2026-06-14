import * as THREE from 'three'
import Terrain, { BlockType } from '../terrain'
import Block from '../terrain/mesh/block'
import Audio from '../audio'
import Survival from '../survival'
import DayNight from '../world/daynight'
import buildMob, { MobKind, MobModel } from './models'
import { isPlaying } from '../utils'

const HOSTILE: MobKind[] = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman']
const PASSIVE: MobKind[] = ['pig', 'cow', 'sheep', 'chicken']

const STATS: Record<MobKind, { hp: number; speed: number; dmg: number }> = {
  zombie: { hp: 10, speed: 2.1, dmg: 3 },
  skeleton: { hp: 8, speed: 2.0, dmg: 2 },
  creeper: { hp: 10, speed: 2.6, dmg: 0 },
  spider: { hp: 8, speed: 3.1, dmg: 2 },
  enderman: { hp: 14, speed: 3.4, dmg: 4 },
  pig: { hp: 4, speed: 1.4, dmg: 0 },
  cow: { hp: 5, speed: 1.3, dmg: 0 },
  sheep: { hp: 4, speed: 1.3, dmg: 0 },
  chicken: { hp: 2, speed: 1.5, dmg: 0 },
  villager: { hp: 10, speed: 1.5, dmg: 0 }
}

interface Mob {
  kind: MobKind
  model: MobModel
  hp: number
  state: 'wander' | 'chase' | 'fuse' | 'dying'
  target: THREE.Vector3 | null
  stateTime: number
  attackCooldown: number
  shootCooldown: number
  fuse: number
  teleportTimer: number
  burnTick: number
  dieTime: number
  anchor: THREE.Vector3 | null
  phase: number
  knock: THREE.Vector3
  flashUntil: number
}

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
}

interface Arrow {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
}

const ZERO_MATRIX = new THREE.Matrix4().set(
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
)

/**
 * Mobs — hostile monsters at night, animals by day, villagers in
 * villages. Simple ground-following AI, melee / arrows / explosions.
 */
export default class Mobs {
  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    terrain: Terrain,
    survival: Survival,
    daynight: DayNight,
    audio: Audio
  ) {
    this.scene = scene
    this.camera = camera
    this.terrain = terrain
    this.survival = survival
    this.daynight = daynight
    this.audio = audio

    // left click attacks mobs before the block handler sees the event
    document.addEventListener(
      'mousedown',
      e => {
        if (e.button !== 0 || !document.pointerLockElement) return
        this.playerAttack() && e.stopPropagation()
      },
      true
    )
  }

  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  terrain: Terrain
  survival: Survival
  daynight: DayNight
  audio: Audio

  mobs: Mob[] = []
  particles: Particle[] = []
  arrows: Arrow[] = []
  effects: { mesh: THREE.Mesh; life: number; grow: number }[] = []

  maxHostile = 8
  maxPassive = 8

  raycaster = new THREE.Raycaster()
  placedTops = new Map<string, number>()
  lastTopsRebuild = 0
  spawnTimer = 0
  lastSeed = NaN
  prev = performance.now()

  particleGeometry = new THREE.BoxGeometry(0.14, 0.14, 0.14)

  // ---------- terrain helpers ----------

  noiseGround = (x: number, z: number) => {
    const noise = this.terrain.noise
    return (
      30 +
      Math.floor(noise.get(x / noise.gap, z / noise.gap, noise.seed) * noise.amp)
    )
  }

  // y of the highest solid block at a column (natural + player built)
  groundTop = (x: number, z: number) => {
    const rx = Math.round(x)
    const rz = Math.round(z)
    const placed = this.placedTops.get(`${rx}_${rz}`)
    const natural = this.noiseGround(rx, rz)
    return placed !== undefined && placed > natural ? placed : natural
  }

  rebuildPlacedTops = () => {
    this.placedTops.clear()
    for (const b of this.terrain.customBlocks) {
      if (!b.placed) continue
      const key = `${b.x}_${b.z}`
      const top = this.placedTops.get(key)
      if (top === undefined || b.y > top) this.placedTops.set(key, b.y)
    }
  }

  // replicate the generation rules to identify a natural block in idMap
  blockTypeAt = (x: number, y: number, z: number): BlockType => {
    const noise = this.terrain.noise
    const yOff = Math.floor(
      noise.get(x / noise.gap, z / noise.gap, noise.seed) * noise.amp
    )
    const surfaceY = 30 + yOff
    if (y <= surfaceY) {
      const stoneOffset =
        noise.get(x / noise.stoneGap, z / noise.stoneGap, noise.stoneSeed) *
        noise.stoneAmp
      const coalOffset =
        noise.get(x / noise.coalGap, z / noise.coalGap, noise.coalSeed) *
        noise.coalAmp
      if (stoneOffset > noise.stoneThreshold) {
        return coalOffset > noise.coalThreshold ? BlockType.coal : BlockType.stone
      }
      return yOff < -3 ? BlockType.sand : BlockType.grass
    }
    const treeOffset =
      noise.get(x / noise.treeGap, z / noise.treeGap, noise.treeSeed) *
      noise.treeAmp
    const stoneOffset =
      noise.get(x / noise.stoneGap, z / noise.stoneGap, noise.stoneSeed) *
      noise.stoneAmp
    if (
      treeOffset > noise.treeThreshold &&
      yOff >= -3 &&
      stoneOffset < noise.stoneThreshold &&
      y <= surfaceY + noise.treeHeight
    ) {
      return BlockType.tree
    }
    return BlockType.leaf
  }

  // remove one natural block (used by explosions); persists like a dig
  removeNaturalBlock = (x: number, y: number, z: number) => {
    if (y <= 0) return false
    const key = `${x}_${y}_${z}`
    const id = this.terrain.idMap.get(key)
    if (id === undefined) return false
    const type = this.blockTypeAt(x, y, z)

    this.terrain.blocks[type].setMatrixAt(id, ZERO_MATRIX)
    this.terrain.blocks[type].instanceMatrix.needsUpdate = true
    this.terrain.idMap.delete(key)

    let existed = false
    for (const b of this.terrain.customBlocks) {
      if (b.x === x && b.y === y && b.z === z) {
        existed = true
        b.placed = false
      }
    }
    if (!existed) {
      this.terrain.customBlocks.push(new Block(x, y, z, type, false))
    }
    this.terrain.generateAdjacentBlocks(new THREE.Vector3(x, y, z))
    return true
  }

  // ---------- spawning ----------

  spawnAt = (kind: MobKind, x: number, z: number, anchor?: THREE.Vector3) => {
    const model = buildMob(kind)
    // mobs stand on top of the ground block (block tops sit at y + 0.5)
    model.group.position.set(x, this.groundTop(x, z) + 0.5, z)
    this.scene.add(model.group)
    const mob: Mob = {
      kind,
      model,
      hp: STATS[kind].hp,
      state: 'wander',
      target: null,
      stateTime: 0,
      attackCooldown: 0,
      shootCooldown: 0,
      fuse: 0,
      teleportTimer: 3 + Math.random() * 3,
      burnTick: 0,
      dieTime: 0,
      anchor: anchor ?? null,
      phase: Math.random() * 10,
      knock: new THREE.Vector3(),
      flashUntil: 0
    }
    this.mobs.push(mob)
    return mob
  }

  spawnAroundPlayer = (kind: MobKind, minDist: number, maxDist: number) => {
    const angle = Math.random() * Math.PI * 2
    const dist = minDist + Math.random() * (maxDist - minDist)
    const x = Math.round(this.camera.position.x + Math.cos(angle) * dist)
    const z = Math.round(this.camera.position.z + Math.sin(angle) * dist)
    return this.spawnAt(kind, x, z)
  }

  pickHostile = (): MobKind => {
    const r = Math.random()
    if (r < 0.34) return 'zombie'
    if (r < 0.58) return 'skeleton'
    if (r < 0.76) return 'spider'
    if (r < 0.93) return 'creeper'
    return 'enderman'
  }

  count = (kinds: MobKind[]) =>
    this.mobs.filter(m => kinds.includes(m.kind) && m.state !== 'dying').length

  villagersNear = (center: THREE.Vector3, radius: number) =>
    this.mobs.filter(
      m =>
        m.kind === 'villager' &&
        m.state !== 'dying' &&
        m.model.group.position.distanceTo(center) < radius
    ).length

  // ---------- combat ----------

  playerAttack = () => {
    const meshes: THREE.Mesh[] = []
    for (const mob of this.mobs) {
      if (mob.state !== 'dying') meshes.push(...mob.model.hitMeshes)
    }
    if (!meshes.length) return false

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)
    this.raycaster.far = 4.5
    const hit = this.raycaster.intersectObjects(meshes, false)[0]
    if (!hit) return false

    // find the mob owning the hit mesh
    const mob = this.mobs.find(m => m.model.hitMeshes.includes(hit.object as THREE.Mesh))
    if (!mob) return false

    const dir = new THREE.Vector3()
      .subVectors(mob.model.group.position, this.camera.position)
      .setY(0)
      .normalize()
    this.damageMob(mob, 3, dir)
    return true
  }

  damageMob = (mob: Mob, amount: number, knockDir?: THREE.Vector3) => {
    if (mob.state === 'dying') return
    mob.hp -= amount
    mob.flashUntil = performance.now() + 140
    for (const mesh of mob.model.hitMeshes) {
      ;(mesh.material as THREE.MeshLambertMaterial).emissive.setHex(0x9c1a1a)
    }
    if (knockDir) {
      mob.knock.copy(knockDir).multiplyScalar(6)
    }
    this.burst(
      mob.model.group.position.clone().setY(mob.model.group.position.y + 1),
      0xa33030,
      6
    )
    this.audio.playSound(BlockType.wood)

    if (mob.hp <= 0) this.killMob(mob)
  }

  killMob = (mob: Mob) => {
    mob.state = 'dying'
    mob.dieTime = 0
    if (HOSTILE.includes(mob.kind)) {
      this.survival.kills++
    } else if (PASSIVE.includes(mob.kind)) {
      // a quick snack
      this.survival.heal(2)
    }
  }

  burst = (pos: THREE.Vector3, color: number, n: number, spread = 2.4) => {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(
        this.particleGeometry,
        new THREE.MeshBasicMaterial({ color, transparent: true })
      )
      mesh.position.copy(pos)
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          Math.random() * spread,
          (Math.random() - 0.5) * spread
        ),
        life: 0.6 + Math.random() * 0.4
      })
    }
  }

  explode = (pos: THREE.Vector3) => {
    // flash sphere
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfff2c8,
        transparent: true,
        opacity: 0.9
      })
    )
    flash.position.copy(pos)
    this.scene.add(flash)
    this.effects.push({ mesh: flash, life: 0.35, grow: 11 })
    this.burst(pos, 0x777777, 26, 7)
    this.burst(pos, 0xff8c2d, 14, 5)
    this.audio.playSound(BlockType.stone)

    // crater
    const r = 2.6
    const cx = Math.round(pos.x)
    const cy = Math.round(pos.y)
    const cz = Math.round(pos.z)
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (dx * dx + dy * dy + dz * dz > r * r) continue
          this.removeNaturalBlock(cx + dx, cy + dy, cz + dz)
        }
      }
    }

    // player damage falls off with distance
    const dist = pos.distanceTo(this.camera.position)
    if (dist < 7) {
      const dmg = Math.round(9 * (1 - dist / 7))
      dmg > 0 && this.survival.damage(dmg, pos, 'a creeper')
    }
  }

  shootArrow = (from: THREE.Vector3, to: THREE.Vector3) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.55),
      new THREE.MeshBasicMaterial({ color: 0xd8d8d8 })
    )
    mesh.position.copy(from)
    const vel = new THREE.Vector3().subVectors(to, from).normalize()
    vel.y += 0.06 // small arc
    vel.normalize().multiplyScalar(17)
    mesh.lookAt(from.clone().add(vel))
    this.scene.add(mesh)
    this.arrows.push({ mesh, vel, life: 2.4 })
  }

  // ---------- per-frame ----------

  update = () => {
    const now = performance.now()
    const delta = Math.min((now - this.prev) / 1000, 0.05)
    this.prev = now

    // new world → clear everything
    if (this.terrain.noise.seed !== this.lastSeed) {
      this.lastSeed = this.terrain.noise.seed
      this.clear()
      return
    }

    if (!isPlaying() || this.survival.dead) return

    if (now - this.lastTopsRebuild > 2000) {
      this.lastTopsRebuild = now
      this.rebuildPlacedTops()
    }

    this.updateSpawning(delta)
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      this.updateMob(this.mobs[i], i, delta, now)
    }
    this.updateArrows(delta)
    this.updateParticles(delta)
    this.updateEffects(delta)
  }

  clear = () => {
    for (const mob of this.mobs) this.scene.remove(mob.model.group)
    for (const p of this.particles) this.scene.remove(p.mesh)
    for (const a of this.arrows) this.scene.remove(a.mesh)
    for (const e of this.effects) this.scene.remove(e.mesh)
    this.mobs = []
    this.particles = []
    this.arrows = []
    this.effects = []
  }

  updateSpawning = (delta: number) => {
    this.spawnTimer -= delta
    if (this.spawnTimer > 0) return
    this.spawnTimer = 1.6

    if (this.daynight.isNight) {
      if (this.count(HOSTILE) < this.maxHostile) {
        this.spawnAroundPlayer(this.pickHostile(), 22, 40)
      }
    } else {
      if (this.count(PASSIVE) < this.maxPassive) {
        this.spawnAroundPlayer(
          PASSIVE[Math.floor(Math.random() * PASSIVE.length)],
          18,
          40
        )
      }
    }
  }

  updateMob = (mob: Mob, index: number, delta: number, now: number) => {
    const group = mob.model.group
    const pos = group.position
    const playerPos = this.camera.position
    const distToPlayer = pos.distanceTo(playerPos)
    const isHostile = HOSTILE.includes(mob.kind)

    // hit flash off
    if (mob.flashUntil && now > mob.flashUntil) {
      mob.flashUntil = 0
      for (const mesh of mob.model.hitMeshes) {
        ;(mesh.material as THREE.MeshLambertMaterial).emissive.setHex(0x000000)
      }
    }

    // death animation: keel over and sink
    if (mob.state === 'dying') {
      mob.dieTime += delta
      group.rotation.z = Math.min((mob.dieTime / 0.4) * (Math.PI / 2), Math.PI / 2)
      if (mob.dieTime > 0.5) pos.y -= delta * 1.2
      if (mob.dieTime > 1.0) {
        this.burst(pos, 0xcccccc, 5)
        this.scene.remove(group)
        this.mobs.splice(index, 1)
      }
      return
    }

    // despawn when far away
    if (distToPlayer > 90) {
      this.scene.remove(group)
      this.mobs.splice(index, 1)
      return
    }

    // undead burn at sunrise; other monsters slink away
    if (isHostile && !this.daynight.isNight) {
      if (mob.kind === 'zombie' || mob.kind === 'skeleton') {
        mob.burnTick += delta
        if (mob.burnTick > 0.7) {
          mob.burnTick = 0
          this.burst(pos.clone().setY(pos.y + 1.5), 0xff7714, 5)
          this.damageMob(mob, 2)
        }
      } else if (this.daynight.daylight() > 0.95) {
        this.burst(pos.clone().setY(pos.y + 1), 0x888888, 8)
        this.scene.remove(group)
        this.mobs.splice(index, 1)
        return
      }
    }

    // knockback decay
    if (mob.knock.lengthSq() > 0.01) {
      pos.x += mob.knock.x * delta
      pos.z += mob.knock.z * delta
      mob.knock.multiplyScalar(Math.max(0, 1 - 9 * delta))
    }

    // --- decide movement ---
    mob.stateTime += delta
    mob.attackCooldown -= delta
    mob.shootCooldown -= delta
    let moveTarget: THREE.Vector3 | null = null
    let speed = STATS[mob.kind].speed

    const aggro =
      isHostile && this.daynight.isNight && distToPlayer < 24 && distToPlayer > 0.5

    if (mob.state === 'fuse') {
      // creeper about to blow: freeze, flash, swell
      mob.fuse += delta
      const s = 1 + (mob.fuse / 1.3) * 0.35
      group.scale.set(s, s, s)
      const on = Math.floor(mob.fuse * 8) % 2 === 0
      for (const mesh of mob.model.hitMeshes) {
        ;(mesh.material as THREE.MeshLambertMaterial).emissive.setHex(
          on ? 0xbbbbbb : 0x000000
        )
      }
      if (distToPlayer > 5) {
        // player escaped — defuse
        mob.state = 'wander'
        mob.fuse = 0
        group.scale.set(1, 1, 1)
      } else if (mob.fuse > 1.3) {
        this.scene.remove(group)
        this.mobs.splice(index, 1)
        this.explode(pos.clone().setY(pos.y + 1))
        return
      }
    } else if (aggro) {
      mob.state = 'chase'

      if (mob.kind === 'skeleton') {
        // keep range and shoot
        if (distToPlayer < 7) {
          moveTarget = pos.clone().add(
            new THREE.Vector3().subVectors(pos, playerPos).setY(0).normalize().multiplyScalar(4)
          )
        } else if (distToPlayer > 13) {
          moveTarget = playerPos
        }
        if (distToPlayer < 15 && mob.shootCooldown <= 0) {
          mob.shootCooldown = 2.2
          this.shootArrow(
            pos.clone().setY(pos.y + 1.5),
            playerPos.clone().setY(playerPos.y - 0.3)
          )
        }
      } else if (mob.kind === 'creeper' && distToPlayer < 3) {
        mob.state = 'fuse'
        mob.fuse = 0
      } else if (mob.kind === 'enderman') {
        moveTarget = playerPos
        mob.teleportTimer -= delta
        if (mob.teleportTimer <= 0 || distToPlayer > 26) {
          mob.teleportTimer = 3 + Math.random() * 3
          this.burst(pos.clone().setY(pos.y + 1.5), 0xc05ce8, 12)
          const angle = Math.random() * Math.PI * 2
          const d = 4 + Math.random() * 5
          pos.x = playerPos.x + Math.cos(angle) * d
          pos.z = playerPos.z + Math.sin(angle) * d
          pos.y = this.groundTop(pos.x, pos.z) + 0.5
          this.burst(pos.clone().setY(pos.y + 1.5), 0xc05ce8, 12)
        }
      } else {
        moveTarget = playerPos
      }

      // melee
      const dmg = STATS[mob.kind].dmg
      if (dmg > 0 && distToPlayer < 1.8 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 1.1
        this.survival.damage(dmg, pos, `a ${mob.kind}`)
      }
    } else {
      // wander
      mob.state = 'wander'
      if (!mob.target || mob.stateTime > 4 + Math.random() * 3) {
        mob.stateTime = 0
        if (Math.random() < 0.65) {
          const around = mob.anchor ?? pos
          const angle = Math.random() * Math.PI * 2
          const d = Math.random() * (mob.anchor ? 13 : 8)
          mob.target = new THREE.Vector3(
            around.x + Math.cos(angle) * d,
            0,
            around.z + Math.sin(angle) * d
          )
        } else {
          mob.target = null // stand around
        }
      }
      if (mob.target && pos.distanceTo(mob.target.clone().setY(pos.y)) > 1) {
        moveTarget = mob.target
        speed *= 0.55
      }
    }

    // --- apply movement ---
    let moving = false
    if (moveTarget && mob.state !== 'fuse') {
      const dir = new THREE.Vector3(
        moveTarget.x - pos.x,
        0,
        moveTarget.z - pos.z
      )
      if (dir.lengthSq() > 0.04) {
        dir.normalize()
        pos.x += dir.x * speed * delta
        pos.z += dir.z * speed * delta
        moving = true
        // face travel direction
        const targetYaw = Math.atan2(dir.x, dir.z)
        let dYaw = targetYaw - group.rotation.y
        while (dYaw > Math.PI) dYaw -= Math.PI * 2
        while (dYaw < -Math.PI) dYaw += Math.PI * 2
        group.rotation.y += dYaw * Math.min(1, 10 * delta)
      }
    }

    // follow the terrain
    const targetY = this.groundTop(pos.x, pos.z) + 0.5
    pos.y += (targetY - pos.y) * Math.min(1, 12 * delta)

    // walk animation
    if (moving) {
      mob.phase += delta * speed * 3.2
      const swing = Math.sin(mob.phase) * 0.55
      mob.model.legs.forEach((leg, i) => {
        if (mob.kind === 'spider') {
          leg.rotation.x = Math.sin(mob.phase + i) * 0.25
        } else {
          leg.rotation.x = i % 2 === 0 ? swing : -swing
        }
      })
      if (mob.kind !== 'zombie') {
        mob.model.arms.forEach((arm, i) => {
          arm.rotation.x = i % 2 === 0 ? -swing * 0.7 : swing * 0.7
        })
      }
    } else {
      mob.model.legs.forEach(leg => (leg.rotation.x *= 0.8))
    }

    // chasing mobs stare at the player
    if (mob.state === 'chase' && mob.model.head) {
      const headYaw =
        Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z) - group.rotation.y
      mob.model.head.rotation.y = Math.max(-1.1, Math.min(1.1, headYaw))
    }
  }

  updateArrows = (delta: number) => {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i]
      arrow.life -= delta
      arrow.vel.y -= 7 * delta
      arrow.mesh.position.addScaledVector(arrow.vel, delta)
      arrow.mesh.lookAt(arrow.mesh.position.clone().add(arrow.vel))

      const hitPlayer =
        arrow.mesh.position.distanceTo(this.camera.position) < 1.1
      const hitGround =
        arrow.mesh.position.y <
        this.groundTop(arrow.mesh.position.x, arrow.mesh.position.z) + 0.4

      if (hitPlayer) {
        this.survival.damage(2, arrow.mesh.position, 'a skeleton')
      }
      if (hitPlayer || hitGround || arrow.life <= 0) {
        this.scene.remove(arrow.mesh)
        this.arrows.splice(i, 1)
      }
    }
  }

  updateParticles = (delta: number) => {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= delta
      if (p.life <= 0) {
        this.scene.remove(p.mesh)
        this.particles.splice(i, 1)
        continue
      }
      p.vel.y -= 6 * delta
      p.mesh.position.addScaledVector(p.vel, delta)
      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life * 2)
    }
  }

  updateEffects = (delta: number) => {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]
      e.life -= delta
      if (e.life <= 0) {
        this.scene.remove(e.mesh)
        this.effects.splice(i, 1)
        continue
      }
      const s = e.mesh.scale.x + e.grow * delta
      e.mesh.scale.set(s, s, s)
      ;(e.mesh.material as THREE.MeshBasicMaterial).opacity = e.life / 0.35
    }
  }
}
