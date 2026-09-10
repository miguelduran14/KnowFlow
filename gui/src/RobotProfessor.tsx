import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { useEffect, useRef } from 'react'

/** Personaje de bienvenida: una versión autocontenida del profesor, sin
 * accesorios ni controles. Todo el render es local; Three se empaqueta con
 * la aplicación en vez de cargarse desde un CDN. */
export function RobotProfessor() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = host.current
    if (!mount) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
    camera.position.set(0, 0.42, 9.15)
    camera.lookAt(0, 0.38, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    // Entorno de estudio procedural: genera reflejos PBR suaves sin HDR ni
    // descargas. El metal deja de parecer plástico plano en ambos temas.
    const envCanvas = document.createElement('canvas')
    envCanvas.width = 32
    envCanvas.height = 128
    const envCtx = envCanvas.getContext('2d')!
    const envGradient = envCtx.createLinearGradient(0, 0, 0, 128)
    envGradient.addColorStop(0, '#ffffff')
    envGradient.addColorStop(0.36, '#d8eef0')
    envGradient.addColorStop(0.58, '#78909c')
    envGradient.addColorStop(1, '#17202b')
    envCtx.fillStyle = envGradient
    envCtx.fillRect(0, 0, 32, 128)
    const envSource = new THREE.CanvasTexture(envCanvas)
    envSource.mapping = THREE.EquirectangularReflectionMapping
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environment = pmrem.fromEquirectangular(envSource).texture
    scene.environment = environment
    envSource.dispose()
    pmrem.dispose()

    const robot = new THREE.Group()
    const headPivot = new THREE.Group()
    const body = new THREE.Group()
    const arms: THREE.Group[] = []
    const mint = new THREE.MeshStandardMaterial({ color: 0x119d8c, roughness: 0.82, metalness: 0.02 })
    const mintDark = new THREE.MeshStandardMaterial({ color: 0x08675f, roughness: 0.9, metalness: 0.02 })
    const metal = new THREE.MeshStandardMaterial({ color: 0xd7dee8, metalness: 0.88, roughness: 0.24 })
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x697687, metalness: 0.92, roughness: 0.34 })
    const rubber = new THREE.MeshStandardMaterial({ color: 0x26313d, metalness: 0.15, roughness: 0.75 })
    const fabricLight = new THREE.MeshStandardMaterial({ color: 0xd8fff6, roughness: 0.92 })

    const torso = new THREE.Mesh(new RoundedBoxGeometry(1.62, 1.48, 1.05, 5, 0.2), mint)
    torso.castShadow = true
    torso.position.y = -0.25
    body.add(torso)

    // Capucha y costuras: convierten el bloque del torso en una prenda y
    // acercan el personaje al tono de "compañero" de KnowFlow.
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.13, 10, 28, Math.PI * 1.18), mintDark)
    hood.position.set(0, 0.45, -0.39)
    hood.rotation.set(Math.PI * 0.5, 0, -Math.PI * 0.09)
    body.add(hood)
    ;[-0.15, 0.15].forEach(x => {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 8), fabricLight)
      cord.position.set(x, 0.22, 0.555)
      body.add(cord)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), metalDark)
      tip.position.set(x, 0, 0.555)
      body.add(tip)
    })
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.94, 0.31, 0.08, 4, 0.06), mintDark)
    pocket.position.set(0, -0.64, 0.56)
    body.add(pocket)

    // Logotipo impreso en la sudadera. La textura se genera en memoria y no
    // introduce recursos remotos ni una fuente externa.
    const logoCanvas = document.createElement('canvas')
    logoCanvas.width = 512
    logoCanvas.height = 128
    const logoCtx = logoCanvas.getContext('2d')!
    logoCtx.textAlign = 'left'
    logoCtx.textBaseline = 'middle'
    logoCtx.font = '700 76px system-ui, sans-serif'
    const fullNameWidth = logoCtx.measureText('KnowFlow').width
    const kWidth = logoCtx.measureText('K').width
    const logoStart = (logoCanvas.width - fullNameWidth) / 2
    logoCtx.fillStyle = '#6ff5d8'
    logoCtx.fillText('K', logoStart, 55)
    logoCtx.fillStyle = '#effefb'
    // Una ligera superposición elimina el hueco óptico entre la K y «now».
    logoCtx.fillText('nowFlow', logoStart + kWidth - 3, 55)
    logoCtx.font = '500 21px ui-monospace, monospace'
    logoCtx.textAlign = 'center'
    logoCtx.fillStyle = 'rgba(239,254,251,.72)'
    logoCtx.fillText('COBOL · CONTEXTO', 256, 105)
    const logoTexture = new THREE.CanvasTexture(logoCanvas)
    logoTexture.colorSpace = THREE.SRGBColorSpace
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 0.27),
      new THREE.MeshStandardMaterial({ map: logoTexture, transparent: true, roughness: 0.88 }),
    )
    logo.position.set(0, -0.17, 0.555)
    body.add(logo)

    ;[-1, 1].forEach(side => {
      const arm = new THREE.Group()
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.48, 6, 12), mint)
      const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.42, 6, 12), mintDark)
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), metal)
      forearm.position.y = -0.59
      hand.position.y = -1.0
      arm.add(upper, forearm, hand)
      arm.position.set(side * 0.97, 0.12, 0)
      arm.rotation.z = side * 0.22
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.215, 18, 14), metalDark)
      shoulder.scale.set(1, 0.82, 1)
      shoulder.position.y = 0.26
      arm.add(shoulder)
      body.add(arm)
      arms.push(arm)

      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.42, 6, 12), metalDark)
      leg.position.set(side * 0.36, -1.42, 0)
      robot.add(leg)
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.16, 0.48, 3, 0.06), metal)
      foot.position.set(side * 0.36, -1.76, 0.12)
      robot.add(foot)
      const sole = new THREE.Mesh(new RoundedBoxGeometry(0.37, 0.055, 0.49, 2, 0.025), rubber)
      sole.position.set(side * 0.36, -1.855, 0.12)
      robot.add(sole)
    })
    robot.add(body)

    // El cuello entra bajo la carcasa de la cabeza y sobre el cuerpo: la
    // solapa evita la "cabeza flotante" al mirar hacia los lados.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.31, 0.56, 16), metalDark)
    neck.position.y = 0.76
    robot.add(neck)
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 20), metal)
    collar.position.y = 0.5
    robot.add(collar)
    const head = new THREE.Mesh(new RoundedBoxGeometry(1.56, 1.22, 1.02, 6, 0.24), metal)
    head.castShadow = true
    headPivot.add(head)

    ;[-1, 1].forEach(side => {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 18), metalDark)
      ear.rotation.z = Math.PI / 2
      ear.position.set(side * 0.84, 0, 0)
      headPivot.add(ear)
      const earLight = new THREE.Mesh(
        new THREE.SphereGeometry(0.052, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0x57e4c4, emissive: 0x57e4c4, emissiveIntensity: 0.65 }),
      )
      earLight.position.set(side * 0.93, 0, 0)
      headPivot.add(earLight)
    })

    const face = document.createElement('canvas')
    face.width = 256
    face.height = 180
    const ctx = face.getContext('2d')!
    const texture = new THREE.CanvasTexture(face)
    texture.colorSpace = THREE.SRGBColorSpace
    const bezel = new THREE.Mesh(
      new RoundedBoxGeometry(1.25, 0.87, 0.08, 4, 0.11),
      new THREE.MeshStandardMaterial({ color: 0x071d24, metalness: 0.55, roughness: 0.32 }),
    )
    bezel.position.set(0, 0.02, 0.515)
    headPivot.add(bezel)
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.11, 0.72),
      new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 1.15 }),
    )
    screen.position.set(0, 0.02, 0.561)
    headPivot.add(screen)
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.11, 0.72),
      new THREE.MeshPhysicalMaterial({
        color: 0xcafcff,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.45,
        transparent: true,
        opacity: 0.12,
        thickness: 0.18,
      }),
    )
    glass.position.set(0, 0.02, 0.568)
    headPivot.add(glass)
    headPivot.position.y = 1.55
    robot.add(headPivot)

    const antenna = new THREE.Group()
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 10), metalDark)
    rod.position.y = 0.21
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xe0b25e, emissive: 0xe0b25e, emissiveIntensity: 1 }),
    )
    bulb.position.y = 0.48
    antenna.add(rod, bulb)
    antenna.position.y = 0.67
    headPivot.add(antenna)

    robot.position.y = -0.05
    robot.rotation.y = -0.035
    scene.add(robot)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x27404b, 1.8))
    const key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(4, 5, 6)
    key.castShadow = true
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x6ee7d0, 1.5)
    rim.position.set(-4, 3, -3)
    scene.add(rim)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 64), new THREE.ShadowMaterial({ opacity: 0.34 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -1.915, 0.15)
    floor.receiveShadow = true
    scene.add(floor)

    robot.traverse(object => {
      if (object instanceof THREE.Mesh && object !== screen && object !== logo) object.castShadow = true
    })

    let pointerX = 0
    let pointerY = 0
    let lookX = 0
    let lookY = 0
    let blink = 0
    let blinkAt = 2
    let pointerInside = false
    let hasPointer = false
    const clock = new THREE.Clock()
    const drawFace = (lid: number, smile: number, brow: number) => {
      const gradient = ctx.createRadialGradient(128, 65, 15, 128, 90, 180)
      gradient.addColorStop(0, '#0a5d69')
      gradient.addColorStop(1, '#031d25')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 256, 180)
      ctx.fillStyle = 'rgba(0,0,0,.1)'
      for (let y = 0; y < 180; y += 5) ctx.fillRect(0, y, 256, 2)
      const eyeY = 77
      ctx.strokeStyle = '#7dffe6'; ctx.lineWidth = 6; ctx.lineCap = 'round'
      for (const browX of [81, 175]) {
        ctx.beginPath()
        ctx.moveTo(browX - 20, 39 + brow * 5)
        ctx.quadraticCurveTo(browX, 31 - brow * 10, browX + 20, 39 + brow * 5)
        ctx.stroke()
      }
      for (const eyeX of [81, 175]) {
        ctx.fillStyle = 'rgba(125,255,230,.25)'
        ctx.beginPath(); ctx.ellipse(eyeX, eyeY, 31, 33, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#04181d'
        ctx.beginPath(); ctx.ellipse(eyeX, eyeY, 24, 27, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#7dffe6'
        ctx.beginPath(); ctx.ellipse(eyeX + lookX * 8, eyeY + lookY * 6, 13, 15, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#eafffb'
        ctx.beginPath(); ctx.ellipse(eyeX + lookX * 8 - 4, eyeY + lookY * 6 - 5, 4, 5, 0, 0, Math.PI * 2); ctx.fill()
        if (lid > 0) { ctx.fillStyle = '#05242c'; ctx.fillRect(eyeX - 28, eyeY - 32, 56, lid * 32); ctx.fillRect(eyeX - 28, eyeY + 32 - lid * 32, 56, lid * 32) }
      }
      ctx.strokeStyle = '#7dffe6'; ctx.lineWidth = 7; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(87, 137); ctx.quadraticCurveTo(128, 148 + smile * 18, 169, 137); ctx.stroke()
      texture.needsUpdate = true
    }

    const onPointer = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect()
      pointerX = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1.25, 1.25)
      pointerY = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height - 0.5) * -2, -1, 1)
      hasPointer = true
    }
    const onPointerEnter = () => { pointerInside = true }
    const onPointerLeave = () => { pointerInside = false; pointerX = 0; pointerY = 0 }
    window.addEventListener('pointermove', onPointer)
    mount.addEventListener('pointerenter', onPointerEnter)
    mount.addEventListener('pointerleave', onPointerLeave)
    const robotBounds = new THREE.Box3().setFromObject(robot)
    const robotSize = robotBounds.getSize(new THREE.Vector3())
    const robotCenter = robotBounds.getCenter(new THREE.Vector3())
    const resize = () => {
      const { width, height } = mount.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      const verticalFov = THREE.MathUtils.degToRad(camera.fov)
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
      const distanceForHeight = robotSize.y / 2 / Math.tan(verticalFov / 2)
      const distanceForWidth = robotSize.x / 2 / Math.tan(horizontalFov / 2)
      camera.position.set(0, robotCenter.y + 0.08, Math.max(distanceForHeight, distanceForWidth) * 1.2 + robotSize.z / 2)
      camera.lookAt(robotCenter.x, robotCenter.y + 0.04, robotCenter.z)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()
    const [leftArm, rightArm] = arms as [THREE.Group, THREE.Group]

    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05)
      const elapsed = clock.elapsedTime
      if (!reduceMotion) {
        const easing = 1 - Math.exp(-dt * 5.5)
        lookX += (pointerX - lookX) * easing
        lookY += (pointerY - lookY) * easing
        const curious = pointerInside ? 1 : 0
        const attention = hasPointer ? 1 : 0
        headPivot.rotation.y = lookX * 0.34 + Math.sin(elapsed * 0.52) * 0.06
        headPivot.rotation.z = Math.sin(elapsed * 0.68) * 0.025 + curious * lookX * -0.035
        headPivot.rotation.x = -lookY * 0.14 + Math.sin(elapsed * 0.45) * 0.025
        body.position.y = Math.sin(elapsed * 1.5) * 0.035
        antenna.rotation.z = Math.sin(elapsed * 2.1) * 0.055
        bulb.material.emissiveIntensity = 0.9 + Math.sin(elapsed * 3.7) * 0.2
        // Saludo inicial y repetición espaciada: gesto legible, no constante.
        const cycle = elapsed % 14
        const waveWindow = elapsed < 2.4 || (cycle > 10.5 && cycle < 12.4)
        const wave = waveWindow ? Math.sin((elapsed < 2.4 ? elapsed : cycle - 10.5) * Math.PI / 1.9) ** 2 : 0
        leftArm.rotation.x = -wave * 0.18
        leftArm.rotation.z = -0.22 - wave * 1.62 + Math.sin(elapsed * 1.25) * 0.04
        rightArm.rotation.z = 0.22 + Math.sin(elapsed * 1.25 + 1.5) * 0.05
        robot.rotation.y += ((-0.035 + lookX * 0.055 * attention) - robot.rotation.y) * easing * 0.45
        blinkAt -= dt
        if (blinkAt < 0) { blink += dt * 12; if (blink > 2) { blink = 0; blinkAt = 2.4 + Math.random() * 2.2 } }
        mount.style.setProperty('--robot-energy', `${20 + curious * 14}%`)
      }
      const smile = pointerInside ? 0.72 : 0.34 + Math.sin(elapsed * 0.4) * 0.08
      const brow = pointerInside ? 0.65 : Math.sin(elapsed * 0.5) * 0.08
      drawFace(blink === 0 ? 0 : blink < 1 ? blink : 2 - blink, smile, brow)
      renderer.render(scene, camera)
    })

    return () => {
      window.removeEventListener('pointermove', onPointer)
      mount.removeEventListener('pointerenter', onPointerEnter)
      mount.removeEventListener('pointerleave', onPointerLeave)
      observer.disconnect()
      renderer.setAnimationLoop(null)
      texture.dispose()
      logoTexture.dispose()
      environment.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={host} className="robot-professor" aria-label="Personaje animado de KnowFlow" />
}
