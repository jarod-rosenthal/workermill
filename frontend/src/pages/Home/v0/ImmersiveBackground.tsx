import { Canvas, useFrame } from "@react-three/fiber"
import { Float, MeshTransmissionMaterial, Environment } from "@react-three/drei"
import { useRef, useState, useEffect } from "react"
import * as THREE from "three"

// Pre-compute random starfield positions once at module level
const STARFIELD_POSITIONS = (() => {
  const count = 300
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 100
    pos[i * 3 + 1] = (Math.random() - 0.5) * 60
    pos[i * 3 + 2] = -20 - Math.random() * 40
  }
  return pos
})()

// Pre-compute random nebula cloud spheres
function generateNebulaShapes() {
  const spheres = []
  for (let i = 0; i < 8; i++) {
    spheres.push({
      pos: [
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1
      ] as [number, number, number],
      scale: 0.5 + Math.random() * 1
    })
  }
  return spheres
}

const NEBULA_SHAPES = [
  generateNebulaShapes(),
  generateNebulaShapes(),
  generateNebulaShapes(),
  generateNebulaShapes(),
]

// Large atmospheric glow - creates depth through light falloff
function AtmosphericGlow({ position, scale, color, intensity = 1 }: {
  position: [number, number, number]
  scale: number
  color: string
  intensity?: number
}) {
  return (
    <group position={position}>
      {/* Core glow */}
      <mesh scale={scale}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.08 * intensity} />
      </mesh>
      {/* Middle layer */}
      <mesh scale={scale * 1.8}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.04 * intensity} />
      </mesh>
      {/* Outer layer */}
      <mesh scale={scale * 3}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.015 * intensity} />
      </mesh>
      {/* Light source */}
      <pointLight color={color} intensity={intensity * 2} distance={25} decay={2} />
    </group>
  )
}

// Glass orbs with refraction - adds visual interest and depth
function GlassOrb({ position, scale, color, speed = 0.5 }: {
  position: [number, number, number]
  scale: number
  color: string
  speed?: number
}) {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * speed) * 0.15
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.1
    }
  })

  return (
    <Float speed={speed} rotationIntensity={0.1} floatIntensity={0.2}>
      <mesh ref={meshRef} position={position} scale={scale}>
        <sphereGeometry args={[1, 64, 64]} />
        <MeshTransmissionMaterial
          color={color}
          transmission={0.9995}
          thickness={0.35}
          roughness={0.015}
          chromaticAberration={0.01}
          anisotropy={0.05}
          distortion={0.03}
          distortionScale={0.03}
          temporalDistortion={0.015}
          ior={1.15}
        />
      </mesh>
    </Float>
  )
}

// Fog plane layers at different depths
function FogLayer({ z, opacity, color }: { z: number; opacity: number; color: string }) {
  return (
    <mesh position={[0, 0, z]} rotation={[0, 0, 0]}>
      <planeGeometry args={[80, 50]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  )
}

// Subtle grid on a distant plane for depth reference
function DepthGrid() {
  const gridRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (gridRef.current) {
      gridRef.current.rotation.x = Math.PI * -0.4 + Math.sin(state.clock.elapsedTime * 0.1) * 0.02
    }
  })

  return (
    <group ref={gridRef} position={[0, -8, -20]} rotation={[Math.PI * -0.4, 0, 0]}>
      <gridHelper args={[240, 40, "#14b8a6", "#14b8a6"]} />
      <mesh position={[0, -0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[240, 240]} />
        <meshBasicMaterial color="#14b8a6" transparent opacity={0.02} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// Floating holographic panels at various depths
function HoloPanel({ position, rotation, size, opacity = 0.04 }: {
  position: [number, number, number]
  rotation: [number, number, number]
  size: [number, number]
  opacity?: number
}) {
  const meshRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.2 + position[0]) * 0.08
    }
  })

  return (
    <group ref={meshRef} position={position} rotation={rotation}>
      {/* Panel background */}
      <mesh>
        <planeGeometry args={size} />
        <meshBasicMaterial color="#14b8a6" transparent opacity={opacity} side={THREE.DoubleSide} />
      </mesh>
      {/* Panel border glow */}
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[size[0] + 0.05, size[1] + 0.05]} />
        <meshBasicMaterial color="#14b8a6" transparent opacity={opacity * 0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* Subtle line details */}
      <mesh position={[0, size[1] * 0.35, 0.01]}>
        <planeGeometry args={[size[0] * 0.8, 0.02]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={opacity * 2} />
      </mesh>
      <mesh position={[0, size[1] * 0.15, 0.01]}>
        <planeGeometry args={[size[0] * 0.6, 0.015]} />
        <meshBasicMaterial color="#14b8a6" transparent opacity={opacity * 1.5} />
      </mesh>
      <mesh position={[0, -size[1] * 0.1, 0.01]}>
        <planeGeometry args={[size[0] * 0.7, 0.015]} />
        <meshBasicMaterial color="#14b8a6" transparent opacity={opacity * 1.5} />
      </mesh>
    </group>
  )
}

// Static starfield for deep background
function Starfield() {
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[STARFIELD_POSITIONS, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#ffffff"
        transparent
        opacity={0.4}
        sizeAttenuation
      />
    </points>
  )
}

// Nebula clouds for atmospheric depth
function NebulaCloud({ position, scale, color, opacity = 0.06, shapeIndex = 0 }: {
  position: [number, number, number]
  scale: number
  color: string
  opacity?: number
  shapeIndex?: number
}) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.z = state.clock.elapsedTime * 0.01
    }
  })

  const spheres = NEBULA_SHAPES[shapeIndex % NEBULA_SHAPES.length]

  return (
    <group ref={groupRef} position={position} scale={scale}>
      {spheres.map((sphere, i) => (
        <mesh key={i} position={sphere.pos} scale={sphere.scale}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} />
        </mesh>
      ))}
    </group>
  )
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#030608"]} />
      <fog attach="fog" args={["#030608", 5, 50]} />

      <ambientLight intensity={0.05} />

      {/* Deep starfield background */}
      <Starfield />

      {/* Nebula clouds at different depths */}
      <NebulaCloud position={[15, 5, -35]} scale={8} color="#14b8a6" opacity={0.03} shapeIndex={0} />
      <NebulaCloud position={[-18, -3, -40]} scale={10} color="#3b82f6" opacity={0.025} shapeIndex={1} />
      <NebulaCloud position={[5, -8, -45]} scale={12} color="#8b5cf6" opacity={0.02} shapeIndex={2} />
      <NebulaCloud position={[-10, 8, -30]} scale={6} color="#0891b2" opacity={0.035} shapeIndex={3} />

      {/* Atmospheric glows - large soft light sources */}
      <AtmosphericGlow position={[12, 4, -20]} scale={5} color="#14b8a6" intensity={1.2} />
      <AtmosphericGlow position={[-10, -3, -25]} scale={6} color="#3b82f6" intensity={0.8} />
      <AtmosphericGlow position={[0, 8, -30]} scale={4} color="#8b5cf6" intensity={0.6} />
      <AtmosphericGlow position={[-15, 5, -18]} scale={3} color="#0891b2" intensity={0.7} />

      {/* Perspective grid floor */}
      <DepthGrid />

      {/* Glass orbs at mid-depth - slow, subtle movement */}
      <GlassOrb position={[8, -2, -10]} scale={2.4} color="#14b8a6" speed={0.3} />
      <GlassOrb position={[-6, -3, -12]} scale={3.0} color="#3b82f6" speed={0.25} />
      <GlassOrb position={[4, -5, -8]} scale={1.6} color="#22d3ee" speed={0.35} />
      <GlassOrb position={[-4, -1, -14]} scale={2.0} color="#8b5cf6" speed={0.2} />
      <GlassOrb position={[10, -6, -16]} scale={1.2} color="#14b8a6" speed={0.4} />

      {/* Holographic panels floating at various depths */}
      <HoloPanel position={[-9, 2, -12]} rotation={[0, 0.3, 0.02]} size={[3.5, 2.5]} opacity={0.035} />
      <HoloPanel position={[11, 1, -14]} rotation={[0, -0.25, -0.02]} size={[3, 2]} opacity={0.03} />
      <HoloPanel position={[-7, -1.5, -9]} rotation={[0.05, 0.15, 0]} size={[2.5, 1.8]} opacity={0.04} />
      <HoloPanel position={[9, -1, -10]} rotation={[-0.03, -0.3, 0.05]} size={[2.8, 2]} opacity={0.035} />
      <HoloPanel position={[0, 4, -18]} rotation={[0.1, 0, 0]} size={[4, 2.5]} opacity={0.025} />
      <HoloPanel position={[-12, 0, -16]} rotation={[0, 0.4, 0]} size={[2.2, 1.6]} opacity={0.03} />

      {/* Fog layers for depth separation */}
      <FogLayer z={-35} opacity={0.15} color="#030608" />
      <FogLayer z={-45} opacity={0.25} color="#030608" />

      <Environment preset="night" />
    </>
  )
}

export function ImmersiveBackground() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)")
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing with matchMedia on mount
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])

  return (
    <div className="fixed inset-0">
      {/* Static gradient background for mobile, 3D canvas for desktop */}
      {isMobile ? (
        <div className="absolute inset-0 bg-[#030608]">
          {/* Subtle teal/blue glow spots to hint at the desktop experience */}
          <div className="absolute top-1/4 right-1/4 w-64 h-64 rounded-full bg-teal-500/[0.07] blur-3xl" />
          <div className="absolute bottom-1/3 left-1/6 w-48 h-48 rounded-full bg-blue-500/[0.05] blur-3xl" />
          <div className="absolute top-1/2 right-1/6 w-32 h-32 rounded-full bg-purple-500/[0.04] blur-3xl" />
        </div>
      ) : (
        <Canvas
          camera={{ position: [0, 0, 8], fov: 55 }}
          gl={{ antialias: true, alpha: false }}
          dpr={[1, 1.5]}
        >
          <Scene />
        </Canvas>
      )}

      {/* Overlay gradients for content readability (desktop only, mobile doesn't need them) */}
      {!isMobile && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Top gradient for header */}
          <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-[#030608] via-[#030608]/70 to-transparent" />
          {/* Left gradient for text content */}
          <div className="absolute top-0 left-0 bottom-0 w-[50%] bg-gradient-to-r from-[#030608]/95 via-[#030608]/60 to-transparent" />
          {/* Bottom gradient */}
          <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-[#030608] via-[#030608]/50 to-transparent" />
          {/* Vignette */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#030608_85%)] opacity-40" />
        </div>
      )}

      {/* Film grain texture */}
      <div
        className="absolute inset-0 opacity-[0.015] pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  )
}
