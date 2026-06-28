import * as THREE from 'three'
import Control from '../../control'
import { Mode } from '../../player'
import { htmlToDom } from '../../utils'
import UI from './joystick.html?raw'

enum ActionKey {
  FRONT = 'front',
  LEFT = 'left',
  RIGHT = 'right',
  BACK = 'back',
  MODE = 'mode',
  JUMP = 'jump',
  UP = 'up',
  DOWN = 'down'
}

export default class Joystick {
  constructor(control: Control) {
    this.control = control
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ')
  }

  control: Control
  euler: THREE.Euler

  // look-gesture state. The look pointer is tracked by id so a second finger can
  // drive the movement joystick at the same time without the camera jumping
  // between the two touches.
  lookId: number | null = null
  lookX = 0
  lookY = 0
  moved = false
  clickTimeout?: ReturnType<typeof setTimeout>
  clickInterval?: ReturnType<typeof setInterval>
  holding = false

  private container?: HTMLElement
  private initialized = false

  // true while the pause menu is open — suspends touch look / build / destroy so
  // taps on the menu don't leak through to the world behind it
  private isPaused = () =>
    !document.querySelector('.menu')?.classList.contains('hidden')

  // emit keyboard event
  private emitKeyboardEvent = (key: string) => {
    return {
      key
    } as KeyboardEvent
  }

  // emit click event
  private emitClickEvent = (button: number) => {
    return {
      button,
      preventDefault: () => { }
    } as MouseEvent
  }

  // init joystick button
  private initButton = ({
    actionKey,
    key
  }: {
    actionKey: ActionKey
    key: string
  }) => {
    const button = document.querySelector(
      `#action-${actionKey}`
    ) as HTMLButtonElement
    button.addEventListener('pointermove', e => {
      e.stopPropagation()
    })
    button.addEventListener('pointerdown', e => {
      this.control.setMovementHandler(this.emitKeyboardEvent(key))
      e.stopPropagation()
    })
    button.addEventListener('pointerup', e => {
      this.control.resetMovementHandler(this.emitKeyboardEvent(key))
      e.stopPropagation()
    })
    // extra config for mode switch button
    if (actionKey === ActionKey.MODE && key === 'q') {
      this.initButton({ actionKey: ActionKey.MODE, key: ' ' })
      button.addEventListener('pointerdown', () => {
        if (this.control.player.mode === Mode.flying) {
          document.querySelector('#action-down')?.classList.remove('hidden')
        } else {
          document.querySelector('#action-down')?.classList.add('hidden')
        }
      })
    }
  }

  init = () => {
    // init() runs on every "Play"/"Resume"; only build the DOM and bind the
    // document-level look handlers once, then just reveal the controls.
    if (this.initialized) {
      this.show()
      return
    }
    this.initialized = true

    htmlToDom(UI)
    this.container = document.querySelector('.joystick') as HTMLElement

    this.initButton({ actionKey: ActionKey.FRONT, key: 'w' })
    this.initButton({ actionKey: ActionKey.LEFT, key: 'a' })
    this.initButton({ actionKey: ActionKey.RIGHT, key: 'd' })
    this.initButton({ actionKey: ActionKey.BACK, key: 's' })
    this.initButton({ actionKey: ActionKey.MODE, key: 'q' })
    this.initButton({ actionKey: ActionKey.UP, key: ' ' })
    this.initButton({ actionKey: ActionKey.DOWN, key: 'Shift' })

    // block select — mobile has no number keys / scroll wheel, so cycle here
    const blockBtn = document.querySelector('#action-block') as HTMLButtonElement
    blockBtn?.addEventListener('pointerdown', e => {
      e.stopPropagation()
      const c = this.control as any
      c.holdingIndex = (c.holdingIndex + 1) % c.holdingBlocks.length
      c.holdingBlock = c.holdingBlocks[c.holdingIndex]
      blockBtn.textContent = String(c.holdingIndex + 1)
      setTimeout(() => { blockBtn.textContent = '🧱' }, 700)
    })
    blockBtn?.addEventListener('pointerup', e => e.stopPropagation())

    // AI word builder — prompt-based on touch (no physical keyboard to type into)
    const buildBtn = document.querySelector('#action-build') as HTMLButtonElement
    buildBtn?.addEventListener('pointerdown', e => {
      e.stopPropagation()
      const wb = (window as any).__game?.wordBuilder
      if (!wb) return
      const desc = window.prompt('Build with words — describe anything:')
      if (desc && desc.trim()) wb.submit(desc.trim())
    })
    buildBtn?.addEventListener('pointerup', e => e.stopPropagation())

    // --- look + tap (camera + place/destroy) -------------------------------
    // The first finger that lands outside a control becomes the look pointer.
    // Buttons stopPropagation on their own pointer events, so a finger on the
    // joystick never hijacks the camera and the two gestures run in parallel.
    document.addEventListener('pointerdown', e => {
      if (this.isPaused() || this.lookId !== null) return
      this.lookId = e.pointerId
      this.lookX = e.pageX
      this.lookY = e.pageY
      this.moved = false

      // hold (no drag) = destroy block, repeating
      this.clickTimeout = setTimeout(() => {
        if (this.moved) return
        this.control.mousedownHandler(this.emitClickEvent(0))
        this.holding = true
        this.clickInterval = setInterval(() => {
          this.control.mousedownHandler(this.emitClickEvent(0))
        }, 333)
      }, 500)
    })

    document.addEventListener('pointermove', e => {
      if (e.pointerId !== this.lookId) return
      const dx = e.pageX - this.lookX
      const dy = e.pageY - this.lookY

      // past the dead-zone it's a look gesture, not a tap — cancel the destroy
      if (!this.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        this.moved = true
        this.clickTimeout && clearTimeout(this.clickTimeout)
      }

      this.euler.setFromQuaternion(this.control.camera.quaternion)
      this.euler.y -= 0.01 * dx
      this.euler.x -= 0.01 * dy
      this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x))
      this.control.camera.quaternion.setFromEuler(this.euler)

      this.lookX = e.pageX
      this.lookY = e.pageY
    })

    const endLook = (e: PointerEvent) => {
      if (e.pointerId !== this.lookId) return
      this.clickTimeout && clearTimeout(this.clickTimeout)
      this.clickInterval && clearInterval(this.clickInterval)

      // a clean tap (no drag, no hold) places a block
      if (!this.holding && !this.moved && !this.isPaused()) {
        this.control.mousedownHandler(this.emitClickEvent(2))
      }
      this.holding = false
      this.lookId = null
    }
    document.addEventListener('pointerup', endLook)
    document.addEventListener('pointercancel', endLook)
  }

  show = () => {
    this.container?.classList.remove('hidden')
  }

  hide = () => {
    this.container?.classList.add('hidden')
    // drop any in-flight gesture so movement / destroy doesn't stick while paused
    this.clickTimeout && clearTimeout(this.clickTimeout)
    this.clickInterval && clearInterval(this.clickInterval)
    this.holding = false
    this.moved = false
    this.lookId = null
  }
}
