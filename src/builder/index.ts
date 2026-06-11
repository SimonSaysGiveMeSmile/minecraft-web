import * as THREE from 'three'
import Terrain, { BlockType } from '../terrain'
import Block from '../terrain/mesh/block'
import Control from '../control'
import Audio from '../audio'
import generate, { Build } from './shapes'
import aiGenerate from './ai'
import { isRenderable } from './font'

/**
 * Word Builder — press B in game, describe anything, and watch it get
 * built block-by-block in front of you.
 */
export default class WordBuilder {
  constructor(
    camera: THREE.PerspectiveCamera,
    terrain: Terrain,
    control: Control,
    audio: Audio
  ) {
    this.camera = camera
    this.terrain = terrain
    this.control = control
    this.audio = audio

    this.initUI()
    this.initListeners()
  }

  camera: THREE.PerspectiveCamera
  terrain: Terrain
  control: Control
  audio: Audio

  active = false
  buffer = ''
  queue: { x: number; y: number; z: number; type: BlockType }[] = []
  queueTotal = 0
  queueName = ''
  perFrame = 1
  placed = 0

  // UI elements
  box = document.createElement('div')
  text = document.createElement('div')
  toast = document.createElement('div')
  hint = document.createElement('div')

  initUI = () => {
    const style = document.createElement('style')
    style.innerHTML = `
      .wb-hint {
        position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
        color: #fff; opacity: 0.55; font-size: 14px; user-select: none;
        text-shadow: 1px 1px 0 #000; pointer-events: none; z-index: 30;
      }
      .wb-box {
        position: fixed; bottom: 48px; left: 50%; transform: translateX(-50%);
        width: min(640px, 90vw); background: rgba(0,0,0,0.72);
        border: 2px solid #888; border-radius: 4px; padding: 10px 14px;
        z-index: 40; pointer-events: none;
      }
      .wb-box .wb-label { color: #8f8; font-size: 13px; margin-bottom: 4px; }
      .wb-box .wb-text {
        color: #fff; font-size: 18px; min-height: 24px; word-break: break-all;
      }
      .wb-box .wb-text::after {
        content: "_"; animation: wb-blink 1s step-start infinite;
      }
      .wb-box .wb-help { color: #aaa; font-size: 12px; margin-top: 6px; }
      @keyframes wb-blink { 50% { opacity: 0; } }
      .wb-toast {
        position: fixed; top: 56px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.72); color: #fff; font-size: 15px;
        border-radius: 4px; padding: 8px 16px; z-index: 40;
        transition: opacity 0.5s ease; pointer-events: none;
        text-shadow: 1px 1px 0 #000;
      }
      .wb-hidden { display: none; }
    `
    document.head.appendChild(style)

    this.hint.className = 'wb-hint wb-hidden'
    this.hint.innerHTML = 'Press <b>B</b> — build anything from words'
    document.body.appendChild(this.hint)

    this.box.className = 'wb-box wb-hidden'
    this.box.innerHTML = `<div class="wb-label">BUILD WITH WORDS</div>`
    this.text.className = 'wb-text'
    this.box.appendChild(this.text)
    const help = document.createElement('div')
    help.className = 'wb-help'
    help.innerHTML =
      'Enter — build it &nbsp;·&nbsp; Esc — cancel &nbsp;·&nbsp; try ' +
      '“a giant glass castle”, “wooden ship”, “rainbow”, or any words at all'
    this.box.appendChild(help)
    document.body.appendChild(this.box)

    this.toast.className = 'wb-toast wb-hidden'
    document.body.appendChild(this.toast)
  }

  initListeners = () => {
    // capture phase so we can swallow keys before the movement handlers
    document.addEventListener('keydown', this.keyHandler, true)

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) {
        this.hint.classList.remove('wb-hidden')
      } else {
        this.hint.classList.add('wb-hidden')
        this.close()
      }
    })
  }

  keyHandler = (e: KeyboardEvent) => {
    if (!this.active) {
      if ((e.key === 'b' || e.key === 'B') && document.pointerLockElement) {
        this.open()
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }

    // typing mode: swallow everything so the player doesn't move
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Enter') {
      const description = this.buffer.trim()
      this.close()
      description && this.submit(description)
    } else if (e.key === 'Escape') {
      this.close()
    } else if (e.key === 'Backspace') {
      this.buffer = this.buffer.slice(0, -1)
      this.text.innerText = this.buffer
    } else if (e.key.length === 1 && this.buffer.length < 60) {
      if (isRenderable(e.key) || /[a-zA-Z0-9!?.\- ]/.test(e.key)) {
        this.buffer += e.key
        this.text.innerText = this.buffer
      }
    }
  }

  open = () => {
    this.active = true
    this.buffer = ''
    this.text.innerText = ''
    this.box.classList.remove('wb-hidden')
    this.hint.classList.add('wb-hidden')
  }

  close = () => {
    this.active = false
    this.box.classList.add('wb-hidden')
    if (document.pointerLockElement) {
      this.hint.classList.remove('wb-hidden')
    }
  }

  showToast = (message: string, fade = false) => {
    this.toast.innerText = message
    this.toast.classList.remove('wb-hidden')
    this.toast.style.opacity = '1'
    if (fade) {
      setTimeout(() => {
        this.toast.style.opacity = '0'
      }, 2500)
    }
  }

  // terrain surface height at a world column (same formula the worker uses)
  groundY = (x: number, z: number) => {
    const noise = this.terrain.noise
    return (
      30 + Math.floor(noise.get(x / noise.gap, z / noise.gap, noise.seed) * noise.amp)
    )
  }

  // AI first (open vocabulary), procedural shapes as the offline fallback
  submit = async (description: string) => {
    this.showToast(`✦ Imagining “${description}”…`)
    const ai = await aiGenerate(description)
    if (ai?.voxels.length) {
      this.build(ai)
      return
    }
    this.build(generate(description))
  }

  build = (result: Build) => {
    const { name, voxels } = result
    if (!voxels.length) {
      return
    }

    // face the structure toward the player (quantized to 90°)
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    dir.y = 0
    if (dir.lengthSq() < 0.001) dir.set(0, 0, 1)
    dir.normalize()
    const dx = Math.abs(dir.x) > Math.abs(dir.z) ? Math.sign(dir.x) : 0
    const dz = dx === 0 ? Math.sign(dir.z) || 1 : 0

    // rotate local +z onto the view direction
    const rotated = voxels.map(v => {
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

    // place it just past the structure's near edge
    let minD = Infinity
    let maxD = -Infinity
    for (const v of rotated) {
      const d = v.x * dx + v.z * dz
      minD = Math.min(minD, d)
      maxD = Math.max(maxD, d)
    }
    const dist = Math.max(6, -minD + 5)
    const cx = Math.round(this.camera.position.x + dir.x * dist)
    const cz = Math.round(this.camera.position.z + dir.z * dist)

    // rest the build on the highest ground column under its footprint,
    // so nothing ends up buried in a hillside
    let baseY = 0
    const columns = new Set<string>()
    for (const v of rotated) {
      const key = `${v.x + cx}_${v.z + cz}`
      if (!columns.has(key)) {
        columns.add(key)
        baseY = Math.max(baseY, this.groundY(v.x + cx, v.z + cz) + 1)
      }
    }

    for (const v of rotated) {
      v.x += cx
      v.y += baseY
      v.z += cz
    }

    // build bottom-up, spiralling out from the center
    rotated.sort(
      (a, b) =>
        a.y - b.y ||
        (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2)
    )

    this.queue.push(...rotated)
    this.queueTotal = this.queue.length
    this.queueName = name
    this.placed = 0
    // whole build takes ~4 seconds regardless of size
    this.perFrame = Math.max(1, Math.ceil(this.queueTotal / 240))
    this.showToast(`Building ${name} — ${this.queueTotal} blocks`)
  }

  placeBlock = (x: number, y: number, z: number, type: BlockType) => {
    // skip if a custom block already occupies this spot
    for (const block of this.terrain.customBlocks) {
      if (block.x === x && block.y === y && block.z === z && block.placed) {
        return false
      }
    }

    // guard the instanced mesh capacity
    const capacity = Math.floor(
      this.terrain.maxCount * this.terrain.blocksFactor[type]
    )
    if (this.terrain.getCount(type) >= capacity - 1) {
      return false
    }

    const matrix = new THREE.Matrix4()
    matrix.setPosition(x, y, z)
    this.terrain.blocks[type].setMatrixAt(this.terrain.getCount(type), matrix)
    this.terrain.setCount(type)
    this.terrain.blocks[type].instanceMatrix.needsUpdate = true
    this.terrain.customBlocks.push(new Block(x, y, z, type, true))
    return true
  }

  update = () => {
    if (!this.queue.length) {
      return
    }
    for (let i = 0; i < this.perFrame && this.queue.length; i++) {
      const v = this.queue.shift()!
      this.placeBlock(v.x, v.y, v.z, v.type)
      this.placed++
      if (this.placed % 16 === 0) {
        this.audio.playSound(v.type)
      }
    }
    if (this.queue.length) {
      const pct = Math.round((this.placed / this.queueTotal) * 100)
      this.showToast(`Building ${this.queueName}… ${pct}%`)
    } else {
      this.showToast(`✓ ${this.queueName} built (${this.queueTotal} blocks)`, true)
    }
  }
}
