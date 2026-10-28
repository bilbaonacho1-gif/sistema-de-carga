/** Vistas de cámara del visor 3D. */
export type CameraPreset = 'front' | 'side' | 'top' | 'iso'
/** 'free' = el usuario movió la cámara a mano. */
export type CameraView = CameraPreset | 'free'
