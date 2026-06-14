import * as THREE from 'three'
import Control from '../control'
import Terrain from '../terrain'
import DayNight from '../world/daynight'
import { Mode } from '../player'
import { isPlaying } from '../utils'

/**
 * Survival layer — health, hearts HUD, fall damage, knockback,
 * death screen and respawn.
 */
export default class Survival {
  constructor(
    camera: THREE.PerspectiveCamera,
    control: Control,
    terrain: Terrain,
    daynight: DayNight
  ) {
    this.camera = camera
    this.control = control
    this.terrain = terrain
    this.daynight = daynight
    this.initUI()
  }

  camera: THREE.PerspectiveCamera
  control: Control
  terrain: Terrain
  daynight: DayNight

  hp = 20
  maxHp = 20
  kills = 0
  dead = false
  lastDamage = 0
  lastRegen = 0

  // fall tracking
  prevY: number | null = null
  fallDist = 0

  // knockback impulse applied over a few frames
  knock = new THREE.Vector3()

  prev = performance.now()

  // UI
  hearts = document.createElement('div')
  info = document.createElement('div')
  flash = document.createElement('div')
  deathScreen = document.createElement('div')

  initUI = () => {
    const style = document.createElement('style')
    style.innerHTML = `
      .sv-hearts {
        position: fixed; bottom: 86px; left: 50%; transform: translateX(-50%);
        font-size: 18px; letter-spacing: 2px; z-index: 30;
        text-shadow: 1px 1px 0 #000; pointer-events: none; user-select: none;
      }
      .sv-hearts .full { color: #e8332a; }
      .sv-hearts .half { color: #f59f4f; }
      .sv-hearts .empty { color: rgba(40,40,40,0.75); }
      .sv-info {
        position: fixed; top: 12px; right: 14px; color: #fff; font-size: 14px;
        text-shadow: 1px 1px 0 #000; z-index: 30; pointer-events: none;
        user-select: none; text-align: right; opacity: 0.85;
      }
      .sv-flash {
        position: fixed; inset: 0; pointer-events: none; z-index: 35;
        background: radial-gradient(ellipse at center,
          rgba(255,0,0,0) 40%, rgba(200,0,0,0.55) 100%);
        opacity: 0; transition: opacity 0.4s ease;
      }
      .sv-death {
        position: fixed; inset: 0; z-index: 60; display: none;
        background: rgba(110, 10, 10, 0.55); text-align: center; color: #fff;
      }
      .sv-death h1 {
        margin-top: 28vh; font-size: 44px; text-shadow: 2px 2px 0 #000;
      }
      .sv-death p { font-size: 16px; text-shadow: 1px 1px 0 #000; }
      .sv-death button {
        margin-top: 24px; padding: 10px 38px; font-size: 18px;
        font-family: inherit; cursor: pointer; color: #fff;
        background: #6c6c6c; border: 2px solid #000;
        box-shadow: inset 2px 2px 0 rgba(255,255,255,0.4),
          inset -2px -2px 0 rgba(0,0,0,0.4);
      }
      .sv-death button:hover { background: #7d7da0; }
      .sv-hidden { display: none; }
    `
    document.head.appendChild(style)

    this.hearts.className = 'sv-hearts sv-hidden'
    document.body.appendChild(this.hearts)

    this.info.className = 'sv-info sv-hidden'
    document.body.appendChild(this.info)

    this.flash.className = 'sv-flash'
    document.body.appendChild(this.flash)

    this.deathScreen.className = 'sv-death'
    this.deathScreen.innerHTML = `<h1>You Died!</h1><p class="sv-cause"></p>`
    const button = document.createElement('button')
    button.innerText = 'Respawn'
    button.addEventListener('click', () => this.respawn())
    this.deathScreen.appendChild(button)
    document.body.appendChild(this.deathScreen)

    // HUD only while playing
    document.addEventListener('pointerlockchange', () => {
      const show = !!document.pointerLockElement
      this.hearts.classList.toggle('sv-hidden', !show)
      this.info.classList.toggle('sv-hidden', !show)
    })

    this.renderHearts()
  }

  renderHearts = () => {
    let html = ''
    for (let i = 0; i < this.maxHp / 2; i++) {
      const cls =
        this.hp >= i * 2 + 2 ? 'full' : this.hp === i * 2 + 1 ? 'half' : 'empty'
      html += `<span class="${cls}">❤</span>`
    }
    this.hearts.innerHTML = html
  }

  groundY = (x: number, z: number) => {
    const noise = this.terrain.noise
    return (
      30 +
      Math.floor(noise.get(x / noise.gap, z / noise.gap, noise.seed) * noise.amp)
    )
  }

  damage = (amount: number, from?: THREE.Vector3, cause = 'a monster') => {
    if (this.dead || amount <= 0) return
    this.hp = Math.max(0, this.hp - Math.round(amount))
    this.lastDamage = performance.now()
    this.renderHearts()

    // red vignette pulse
    this.flash.style.transition = 'none'
    this.flash.style.opacity = '1'
    requestAnimationFrame(() => {
      this.flash.style.transition = 'opacity 0.45s ease'
      this.flash.style.opacity = '0'
    })

    // horizontal knockback away from the source
    if (from) {
      this.knock
        .set(this.camera.position.x - from.x, 0, this.camera.position.z - from.z)
        .normalize()
        .multiplyScalar(5)
    }

    if (this.hp <= 0) this.die(cause)
  }

  heal = (amount: number) => {
    if (this.dead) return
    this.hp = Math.min(this.maxHp, this.hp + amount)
    this.renderHearts()
  }

  die = (cause: string) => {
    this.dead = true
    const p = this.deathScreen.querySelector('.sv-cause') as HTMLElement
    p.innerText = `Slain by ${cause} · Kills: ${this.kills}`
    this.deathScreen.style.display = 'block'
    this.control.control.unlock()
  }

  respawn = () => {
    this.hp = this.maxHp
    this.dead = false
    this.fallDist = 0
    this.prevY = null
    this.knock.set(0, 0, 0)
    this.renderHearts()
    this.deathScreen.style.display = 'none'

    // back to world spawn
    this.camera.position.set(8, this.groundY(8, 8) + 3, 8)
    this.control.control.lock()
  }

  update = () => {
    const now = performance.now()
    const delta = Math.min((now - this.prev) / 1000, 0.1)
    this.prev = now

    // day / time / kills readout
    this.info.innerHTML = `Day ${this.daynight.day} ${
      this.daynight.isNight ? '☾' : '☀'
    } &nbsp;·&nbsp; ⚔ ${this.kills}`

    if (!isPlaying() || this.dead) return

    // knockback decay
    if (this.knock.lengthSq() > 0.01) {
      this.camera.position.x += this.knock.x * delta
      this.camera.position.z += this.knock.z * delta
      this.knock.multiplyScalar(Math.max(0, 1 - 8 * delta))
    }

    // regen when out of combat
    if (
      this.hp < this.maxHp &&
      now - this.lastDamage > 8000 &&
      now - this.lastRegen > 3000
    ) {
      this.lastRegen = now
      this.heal(1)
    }

    // fall damage (walking / sneaking only)
    const mode = this.control.player.mode
    const y = this.camera.position.y
    if (mode === Mode.walking || mode === Mode.sneaking) {
      if (this.prevY !== null) {
        const dy = y - this.prevY
        if (dy < -0.02) {
          this.fallDist -= dy
        } else {
          if (this.fallDist > 4.5) {
            this.damage(Math.floor(this.fallDist - 3.5), undefined, 'the fall')
          }
          this.fallDist = 0
        }
      }
      this.prevY = y
    } else {
      this.fallDist = 0
      this.prevY = null
    }
  }
}
