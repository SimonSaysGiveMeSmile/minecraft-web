export const htmlToDom = (html: string) => {
  const templateDom = document.createElement('template')
  templateDom.innerHTML = html
  window.document.body.appendChild(templateDom.content)
}

export const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(
  navigator.userAgent
)

// true while the player is actually in game (menu closed); the
// __forceActive escape hatch keeps automated tests running without
// pointer lock (which can't be acquired synthetically)
export const isPlaying = () =>
  !!document.pointerLockElement || isMobile || !!(window as any).__forceActive
