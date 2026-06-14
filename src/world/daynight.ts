import * as THREE from 'three'
import Core from '../core'
import { isPlaying } from '../utils'

const DAY_SKY = new THREE.Color(0x87ceeb)
const NIGHT_SKY = new THREE.Color(0x0b1026)
const SUNSET = new THREE.Color(0xfd9b4d)

/**
 * Day / night cycle — drives sky, fog, lighting, a square sun + moon
 * and a field of stars. Time only advances while playing.
 */
export default class DayNight {
  constructor(core: Core) {
    this.core = core
    this.initSky()
  }

  core: Core

  // t in [0, 1): 0-0.45 day, 0.45-0.55 dusk, 0.55-0.95 night, 0.95-1 dawn
  t = 0.05
  cycleSeconds = 480
  day = 1

  sky = new THREE.Group()
  sun = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.MeshBasicMaterial({ color: 0xfff8b0, fog: false })
  )
  moon = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 22),
    new THREE.MeshBasicMaterial({ color: 0xd8dee8, fog: false })
  )
  stars!: THREE.Points
  starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.6,
    fog: false,
    transparent: true,
    opacity: 0
  })

  prev = performance.now()

  initSky = () => {
    // stars on a dome
    const positions: number[] = []
    for (let i = 0; i < 420; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 0.95)
      const r = 440
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      )
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    )
    this.stars = new THREE.Points(geometry, this.starsMaterial)

    this.sky.add(this.sun, this.moon, this.stars)
    this.core.scene.add(this.sky)
  }

  // daylight factor: 1 = noon, 0 = midnight
  daylight = () => {
    const t = this.t
    if (t < 0.45) return 1
    if (t < 0.55) return 1 - (t - 0.45) / 0.1
    if (t < 0.95) return 0
    return (t - 0.95) / 0.05
  }

  get isNight() {
    return this.daylight() < 0.3
  }

  setTime = (t: number) => {
    this.t = ((t % 1) + 1) % 1
  }

  update = () => {
    const now = performance.now()
    const delta = Math.min((now - this.prev) / 1000, 0.1)
    this.prev = now

    if (isPlaying()) {
      const before = this.t
      this.t = (this.t + delta / this.cycleSeconds) % 1
      if (this.t < before) this.day++
    }

    const d = this.daylight()
    const camera = this.core.camera

    // sky + fog color (orange tint at dusk / dawn)
    const sunset = (1 - Math.abs(2 * d - 1)) * 0.55
    const skyColor = NIGHT_SKY.clone().lerp(DAY_SKY, d).lerp(SUNSET, sunset)
    ;(this.core.scene.background as THREE.Color).copy(skyColor)
    this.core.scene.fog instanceof THREE.Fog &&
      this.core.scene.fog.color.copy(skyColor)

    // lighting
    this.core.sunLight.intensity = 0.08 + 0.42 * d
    this.core.sunLight2.intensity = 0.04 + 0.16 * d
    this.core.ambient.intensity = 0.32 + 0.68 * d

    // sun and moon ride opposite halves of the cycle
    this.sky.position.copy(camera.position)
    const r = 420
    const sunAngle = Math.PI * Math.min(this.t / 0.5, 1) // day phase
    this.sun.position.set(
      Math.cos(sunAngle) * r,
      Math.sin(sunAngle) * r * 0.85 + 12,
      r * 0.18
    )
    this.sun.lookAt(camera.position)
    this.sun.visible = this.t < 0.52

    const moonAngle = Math.PI * Math.max((this.t - 0.5) / 0.5, 0)
    this.moon.position.set(
      Math.cos(moonAngle) * r,
      Math.sin(moonAngle) * r * 0.85 + 12,
      -r * 0.18
    )
    this.moon.lookAt(camera.position)
    this.moon.visible = this.t > 0.48

    this.starsMaterial.opacity = 1 - d
    this.stars.visible = d < 0.97
  }
}
