export const htmlToDom = (html: string) => {
  const templateDom = document.createElement('template')
  templateDom.innerHTML = html
  window.document.body.appendChild(templateDom.content)
}

// UA match catches most phones; iPadOS 13+ (and some tablets) report a desktop
// UA, so also treat a coarse PRIMARY pointer with touch points as mobile. Using
// `(pointer: coarse)` (not `any-pointer`) keeps touchscreen laptops on desktop.
export const isMobile =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(navigator.userAgent) ||
  (typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches &&
    (navigator.maxTouchPoints || 0) > 0)

// true while the player is actually in game (menu closed); the
// __forceActive escape hatch keeps automated tests running without
// pointer lock (which can't be acquired synthetically)
export const isPlaying = () =>
  !!document.pointerLockElement || isMobile || !!(window as any).__forceActive
