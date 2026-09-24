export interface SliceRegion {
  id: string
  name: string
  kind: 'image' | 'text'
  x: number
  y: number
  width: number
  height: number
  z: number
  text?: string
  fontSize?: number
  fontFamily?: string
  color?: string
}

export interface SliceLayer extends SliceRegion {
  bytes?: Uint8Array
}

export interface SliceResult {
  version: 1
  name: string
  width: number
  height: number
  layers: SliceLayer[]
}

export interface SliceSource {
  name: string
  width: number
  height: number
  dataURL: string
}
