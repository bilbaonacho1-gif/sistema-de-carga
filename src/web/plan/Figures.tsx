/**
 * FIGURAS PARA VER LA ESCALA en el 3D: una persona (1,75 m, con casco) y un autoelevador. Se ponen
 * en el plano como símbolos y acá se ven de cuerpo entero, al lado de los racks.
 */
import * as THREE from 'three'

const F = {
  skin: new THREE.MeshStandardMaterial({ color: '#dba77e', roughness: 0.8 }),
  shirt: new THREE.MeshStandardMaterial({ color: '#2f6fb8', roughness: 0.8 }),
  vest: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.7 }),
  pants: new THREE.MeshStandardMaterial({ color: '#30353c', roughness: 0.85 }),
  helmet: new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.4 }),
  body: new THREE.MeshStandardMaterial({ color: '#ea5b17', roughness: 0.5, metalness: 0.15 }),
  dark: new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.7 }),
  steel: new THREE.MeshStandardMaterial({ color: '#8f969d', roughness: 0.5, metalness: 0.6 }),
  picked: new THREE.MeshStandardMaterial({ color: '#be1e30', roughness: 0.6, emissive: '#be1e30', emissiveIntensity: 0.25 }),
}

/** Altura de la persona y de sus ojos (m). */
export const PERSON_HEIGHT = 1.75
export const EYE_HEIGHT = 1.65

/** Una persona de 1,75 m parada en el piso (origen entre los pies). */
export function Person({ selected }: { selected?: boolean }) {
  const shirt = selected ? F.picked : F.shirt
  return (
    <group>
      {[-0.09, 0.09].map((x) => <mesh key={x} material={F.pants} position={[x, 0.42, 0]} castShadow><boxGeometry args={[0.13, 0.84, 0.15]} /></mesh>)}
      <mesh material={shirt} position={[0, 1.13, 0]} castShadow><boxGeometry args={[0.4, 0.58, 0.22]} /></mesh>
      <mesh material={F.vest} position={[0, 1.16, 0]}><boxGeometry args={[0.42, 0.4, 0.24]} /></mesh>
      {[-0.26, 0.26].map((x) => <mesh key={x} material={shirt} position={[x, 1.1, 0]} castShadow><boxGeometry args={[0.1, 0.6, 0.12]} /></mesh>)}
      <mesh material={F.skin} position={[0, 1.56, 0]} castShadow><sphereGeometry args={[0.11, 16, 12]} /></mesh>
      <mesh material={F.helmet} position={[0, 1.62, 0]}><sphereGeometry args={[0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
    </group>
  )
}

/** Un autoelevador contrapesado: unos 2,2 m de alto y 3,3 m de largo con las uñas (mira hacia -Z). */
export function Forklift({ selected }: { selected?: boolean }) {
  const body = selected ? F.picked : F.body
  return (
    <group>
      <mesh material={body} position={[0, 0.62, 0.35]} castShadow><boxGeometry args={[1.15, 0.75, 1.9]} /></mesh>
      <mesh material={F.dark} position={[0, 0.5, 1.2]} castShadow><boxGeometry args={[1.1, 0.7, 0.35]} /></mesh>
      <mesh material={F.dark} position={[0, 1.05, 0.45]}><boxGeometry args={[0.5, 0.35, 0.5]} /></mesh>
      {[[-0.5, -0.45], [0.5, -0.45], [-0.5, 1.15], [0.5, 1.15]].map(([x, z]) => <mesh key={`${x}${z}`} material={F.dark} position={[x, 1.55, z]}><boxGeometry args={[0.06, 1.15, 0.06]} /></mesh>)}
      <mesh material={F.dark} position={[0, 2.14, 0.35]} castShadow><boxGeometry args={[1.1, 0.06, 1.7]} /></mesh>
      {[-0.32, 0.32].map((x) => <mesh key={x} material={F.steel} position={[x, 1.1, -0.72]} castShadow><boxGeometry args={[0.1, 2.2, 0.12]} /></mesh>)}
      <mesh material={F.steel} position={[0, 0.5, -0.8]}><boxGeometry args={[0.9, 0.45, 0.06]} /></mesh>
      {[-0.25, 0.25].map((x) => <mesh key={x} material={F.steel} position={[x, 0.08, -1.38]}><boxGeometry args={[0.12, 0.05, 1.15]} /></mesh>)}
      {[[-0.55, -0.35], [0.55, -0.35], [-0.5, 1.0], [0.5, 1.0]].map(([x, z]) => (
        <mesh key={`w${x}${z}`} material={F.dark} position={[x, 0.3, z]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.3, 0.3, 0.22, 16]} /></mesh>
      ))}
    </group>
  )
}
