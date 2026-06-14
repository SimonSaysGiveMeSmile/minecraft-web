import Core from './core'
import Control from './control'
import Player from './player'
import Terrain from './terrain'
import UI from './ui'
import Audio from './audio'
import WordBuilder from './builder'
import DayNight from './world/daynight'
import Survival from './survival'
import Mobs from './mobs'
import Villages from './world/villages'

import './style.css'

const core = new Core()
const camera = core.camera
const scene = core.scene
const renderer = core.renderer

const player = new Player()
const audio = new Audio(camera)

const terrain = new Terrain(scene, camera)
const control = new Control(scene, camera, player, terrain, audio)

const ui = new UI(terrain, control)
const wordBuilder = new WordBuilder(camera, terrain, control, audio)

const daynight = new DayNight(core)
const survival = new Survival(camera, control, terrain, daynight)
const mobs = new Mobs(scene, camera, terrain, survival, daynight, audio)
const villages = new Villages(terrain, camera, mobs)

// debug handle (used by automated tests; same spirit as f22's window.__ci)
;(window as any).__game = {
  camera,
  scene,
  terrain,
  control,
  ui,
  wordBuilder,
  daynight,
  survival,
  mobs,
  villages
}

// animation
;(function animate() {
  // let p1 = performance.now()
  requestAnimationFrame(animate)

  control.update()
  terrain.update()
  ui.update()
  wordBuilder.update()
  daynight.update()
  survival.update()
  mobs.update()
  villages.update()

  renderer.render(scene, camera)
  // console.log(performance.now()-p1)
})()
