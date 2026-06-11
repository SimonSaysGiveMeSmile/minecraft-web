import Core from './core'
import Control from './control'
import Player from './player'
import Terrain from './terrain'
import UI from './ui'
import Audio from './audio'
import WordBuilder from './builder'

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

// debug handle (used by automated tests; same spirit as f22's window.__ci)
;(window as any).__game = { camera, scene, terrain, control, ui, wordBuilder }

// animation
;(function animate() {
  // let p1 = performance.now()
  requestAnimationFrame(animate)

  control.update()
  terrain.update()
  ui.update()
  wordBuilder.update()

  renderer.render(scene, camera)
  // console.log(performance.now()-p1)
})()
