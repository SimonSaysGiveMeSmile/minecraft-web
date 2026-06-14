import * as THREE from 'three'

export type MobKind =
  | 'zombie'
  | 'skeleton'
  | 'creeper'
  | 'spider'
  | 'enderman'
  | 'pig'
  | 'cow'
  | 'sheep'
  | 'chicken'
  | 'villager'

export interface MobModel {
  group: THREE.Group
  head: THREE.Object3D | null
  legs: THREE.Mesh[]
  arms: THREE.Mesh[]
  height: number
  hitMeshes: THREE.Mesh[]
}

const mat = (color: number) => new THREE.MeshLambertMaterial({ color })

// plain box part, positioned by center
const box = (
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number
) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

// limb pivoting at its top (for walk swing)
const limb = (
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number
) => {
  const geometry = new THREE.BoxGeometry(w, h, d)
  geometry.translate(0, -h / 2, 0)
  const mesh = new THREE.Mesh(geometry, mat(color))
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

// all models stand on y=0, face +z
export default function buildMob(kind: MobKind): MobModel {
  const group = new THREE.Group()
  const legs: THREE.Mesh[] = []
  const arms: THREE.Mesh[] = []
  let head: THREE.Object3D | null = null
  let height = 1.8

  const humanoid = (
    skin: number,
    shirt: number,
    pants: number,
    armsForward = false,
    armColor = skin
  ) => {
    legs.push(
      limb(group, 0.24, 0.72, 0.24, pants, -0.14, 0.72, 0),
      limb(group, 0.24, 0.72, 0.24, pants, 0.14, 0.72, 0)
    )
    box(group, 0.52, 0.72, 0.28, shirt, 0, 1.08, 0)
    const armY = 1.4
    const a1 = limb(group, 0.2, 0.68, 0.2, armColor, -0.38, armY, 0)
    const a2 = limb(group, 0.2, 0.68, 0.2, armColor, 0.38, armY, 0)
    if (armsForward) {
      a1.rotation.x = -Math.PI / 2
      a2.rotation.x = -Math.PI / 2
    }
    arms.push(a1, a2)
    head = new THREE.Group()
    head.position.set(0, 1.69, 0)
    group.add(head)
    box(head, 0.5, 0.5, 0.5, skin, 0, 0.25, 0)
    height = 1.95
    return head
  }

  switch (kind) {
    case 'zombie': {
      const h = humanoid(0x44a838, 0x00939c, 0x35577e, true)
      box(h, 0.1, 0.08, 0.04, 0x10260e, -0.12, 0.32, 0.25)
      box(h, 0.1, 0.08, 0.04, 0x10260e, 0.12, 0.32, 0.25)
      break
    }
    case 'skeleton': {
      const h = humanoid(0xd6d6d6, 0x9c9c9c, 0xbfbfbf)
      box(h, 0.1, 0.1, 0.04, 0x222222, -0.12, 0.3, 0.25)
      box(h, 0.1, 0.1, 0.04, 0x222222, 0.12, 0.3, 0.25)
      box(h, 0.18, 0.06, 0.04, 0x222222, 0, 0.12, 0.25)
      break
    }
    case 'enderman': {
      legs.push(
        limb(group, 0.16, 1.4, 0.16, 0x131313, -0.12, 1.4, 0),
        limb(group, 0.16, 1.4, 0.16, 0x131313, 0.12, 1.4, 0)
      )
      box(group, 0.5, 0.78, 0.24, 0x131313, 0, 1.8, 0)
      arms.push(
        limb(group, 0.14, 1.2, 0.14, 0x131313, -0.34, 2.15, 0),
        limb(group, 0.14, 1.2, 0.14, 0x131313, 0.34, 2.15, 0)
      )
      head = new THREE.Group()
      head.position.set(0, 2.2, 0)
      group.add(head)
      box(head, 0.46, 0.46, 0.46, 0x131313, 0, 0.23, 0)
      box(head, 0.16, 0.08, 0.04, 0xdd6eff, -0.13, 0.26, 0.23)
      box(head, 0.16, 0.08, 0.04, 0xdd6eff, 0.13, 0.26, 0.23)
      height = 2.9
      break
    }
    case 'creeper': {
      // four stubby legs, tall body, no arms
      legs.push(
        limb(group, 0.24, 0.36, 0.24, 0x3d8a30, -0.15, 0.36, 0.2),
        limb(group, 0.24, 0.36, 0.24, 0x3d8a30, 0.15, 0.36, 0.2),
        limb(group, 0.24, 0.36, 0.24, 0x3d8a30, -0.15, 0.36, -0.2),
        limb(group, 0.24, 0.36, 0.24, 0x3d8a30, 0.15, 0.36, -0.2)
      )
      box(group, 0.46, 0.9, 0.3, 0x4faa3c, 0, 0.81, 0)
      head = new THREE.Group()
      head.position.set(0, 1.26, 0)
      group.add(head)
      box(head, 0.5, 0.5, 0.5, 0x4faa3c, 0, 0.25, 0)
      // that face
      box(head, 0.12, 0.12, 0.04, 0x0c1c0a, -0.12, 0.32, 0.25)
      box(head, 0.12, 0.12, 0.04, 0x0c1c0a, 0.12, 0.32, 0.25)
      box(head, 0.12, 0.18, 0.04, 0x0c1c0a, 0, 0.14, 0.25)
      box(head, 0.06, 0.12, 0.04, 0x0c1c0a, -0.09, 0.1, 0.25)
      box(head, 0.06, 0.12, 0.04, 0x0c1c0a, 0.09, 0.1, 0.25)
      height = 1.76
      break
    }
    case 'spider': {
      box(group, 0.8, 0.42, 1.0, 0x1d1d1d, 0, 0.55, -0.25)
      head = new THREE.Group()
      head.position.set(0, 0.5, 0.4)
      group.add(head)
      box(head, 0.5, 0.42, 0.5, 0x262626, 0, 0, 0)
      box(head, 0.08, 0.08, 0.04, 0xcc2222, -0.14, 0.08, 0.26)
      box(head, 0.08, 0.08, 0.04, 0xcc2222, 0.14, 0.08, 0.26)
      box(head, 0.06, 0.06, 0.04, 0xcc2222, -0.05, 0.02, 0.26)
      box(head, 0.06, 0.06, 0.04, 0xcc2222, 0.05, 0.02, 0.26)
      // eight legs
      for (let i = 0; i < 4; i++) {
        const z = 0.25 - i * 0.3
        const l1 = limb(group, 0.1, 0.7, 0.1, 0x161616, -0.45, 0.6, z)
        const l2 = limb(group, 0.1, 0.7, 0.1, 0x161616, 0.45, 0.6, z)
        l1.rotation.z = 0.7
        l2.rotation.z = -0.7
        legs.push(l1, l2)
      }
      height = 0.9
      break
    }
    case 'pig': {
      quadruped(group, legs, 0xeaa3a0, 0.9, 0.55, 1.1, 0.4)
      head = new THREE.Group()
      head.position.set(0, 0.75, 0.65)
      group.add(head)
      box(head, 0.55, 0.5, 0.45, 0xeaa3a0, 0, 0, 0)
      box(head, 0.24, 0.16, 0.08, 0xd0807d, 0, -0.08, 0.26)
      box(head, 0.07, 0.07, 0.04, 0x222222, -0.14, 0.1, 0.24)
      box(head, 0.07, 0.07, 0.04, 0x222222, 0.14, 0.1, 0.24)
      height = 1.0
      break
    }
    case 'cow': {
      quadruped(group, legs, 0x5e3f29, 0.95, 0.65, 1.3, 0.55)
      // white patches
      box(group, 0.97, 0.3, 0.4, 0xe9e9e9, 0, 1.0, -0.3)
      box(group, 0.4, 0.3, 0.5, 0xe9e9e9, 0.29, 0.85, 0.3)
      head = new THREE.Group()
      head.position.set(0, 1.15, 0.8)
      group.add(head)
      box(head, 0.5, 0.45, 0.4, 0x5e3f29, 0, 0, 0)
      box(head, 0.3, 0.18, 0.06, 0xd8c9b8, 0, -0.14, 0.21)
      box(head, 0.07, 0.07, 0.04, 0x222222, -0.13, 0.08, 0.21)
      box(head, 0.07, 0.07, 0.04, 0x222222, 0.13, 0.08, 0.21)
      // horns
      box(head, 0.1, 0.1, 0.1, 0xd8d0c0, -0.3, 0.2, 0)
      box(head, 0.1, 0.1, 0.1, 0xd8d0c0, 0.3, 0.2, 0)
      height = 1.45
      break
    }
    case 'sheep': {
      quadruped(group, legs, 0xd9cfc4, 0.85, 0.6, 1.1, 0.5)
      // puffy wool overlay
      box(group, 1.0, 0.72, 1.22, 0xefefef, 0, 0.95, 0)
      head = new THREE.Group()
      head.position.set(0, 1.15, 0.72)
      group.add(head)
      box(head, 0.42, 0.4, 0.4, 0xd9cfc4, 0, 0, 0)
      box(head, 0.46, 0.3, 0.3, 0xefefef, 0, 0.12, -0.08)
      box(head, 0.06, 0.06, 0.04, 0x222222, -0.11, 0.04, 0.21)
      box(head, 0.06, 0.06, 0.04, 0x222222, 0.11, 0.04, 0.21)
      height = 1.45
      break
    }
    case 'chicken': {
      legs.push(
        limb(group, 0.07, 0.35, 0.07, 0xe0a13c, -0.1, 0.35, 0),
        limb(group, 0.07, 0.35, 0.07, 0xe0a13c, 0.1, 0.35, 0)
      )
      box(group, 0.4, 0.4, 0.55, 0xf2f2f2, 0, 0.55, 0)
      // wings
      box(group, 0.08, 0.3, 0.4, 0xe4e4e4, -0.24, 0.6, 0)
      box(group, 0.08, 0.3, 0.4, 0xe4e4e4, 0.24, 0.6, 0)
      head = new THREE.Group()
      head.position.set(0, 0.8, 0.22)
      group.add(head)
      box(head, 0.24, 0.36, 0.24, 0xf2f2f2, 0, 0.14, 0)
      box(head, 0.14, 0.08, 0.1, 0xe0a13c, 0, 0.12, 0.16)
      box(head, 0.1, 0.12, 0.06, 0xc92f2f, 0, 0.0, 0.14)
      box(head, 0.05, 0.05, 0.03, 0x222222, -0.08, 0.22, 0.13)
      box(head, 0.05, 0.05, 0.03, 0x222222, 0.08, 0.22, 0.13)
      height = 0.85
      break
    }
    case 'villager': {
      legs.push(
        limb(group, 0.22, 0.6, 0.22, 0x4a3526, -0.13, 0.6, 0),
        limb(group, 0.22, 0.6, 0.22, 0x4a3526, 0.13, 0.6, 0)
      )
      // long robe
      box(group, 0.56, 0.85, 0.34, 0x8b6f47, 0, 1.0, 0)
      // crossed arms
      box(group, 0.62, 0.18, 0.2, 0x755c3a, 0, 1.18, 0.18)
      head = new THREE.Group()
      head.position.set(0, 1.55, 0)
      group.add(head)
      box(head, 0.5, 0.55, 0.5, 0xc9a07a, 0, 0.28, 0)
      // the nose
      box(head, 0.12, 0.26, 0.12, 0xb98e68, 0, 0.16, 0.3)
      box(head, 0.42, 0.08, 0.04, 0x5d4a32, 0, 0.42, 0.26) // unibrow
      box(head, 0.08, 0.07, 0.04, 0x274623, -0.13, 0.32, 0.26)
      box(head, 0.08, 0.07, 0.04, 0x274623, 0.13, 0.32, 0.26)
      height = 2.1
      break
    }
  }

  const hitMeshes: THREE.Mesh[] = []
  group.traverse(o => {
    if (o instanceof THREE.Mesh) hitMeshes.push(o)
  })

  return { group, head, legs, arms, height, hitMeshes }
}

// shared four-legged body
function quadruped(
  group: THREE.Group,
  legs: THREE.Mesh[],
  color: number,
  w: number,
  h: number,
  d: number,
  legH: number
) {
  legs.push(
    limb(group, 0.22, legH, 0.22, color, -(w / 2 - 0.15), legH, d / 2 - 0.18),
    limb(group, 0.22, legH, 0.22, color, w / 2 - 0.15, legH, d / 2 - 0.18),
    limb(group, 0.22, legH, 0.22, color, -(w / 2 - 0.15), legH, -(d / 2 - 0.18)),
    limb(group, 0.22, legH, 0.22, color, w / 2 - 0.15, legH, -(d / 2 - 0.18))
  )
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
  body.position.set(0, legH + h / 2 - 0.05, 0)
  group.add(body)
}
