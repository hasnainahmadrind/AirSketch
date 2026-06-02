export type GestureType = 'DRAW' | 'HOVER' | 'ERASE' | 'PINCH_CLEAR' | 'NONE';

export type AppStatus = 'LOADING_RESOURCES' | 'LOADING_CAMERA' | 'READY' | 'ERROR';

export interface Point {
  x: number;
  y: number;
  color: string;
  size: number;
  isEraser: boolean;
  isStart: boolean; // Indicates if this point starts a new path stroke
}

export interface BrushSettings {
  color: string;
  size: number;
  isEraser: boolean;
}

export interface AppStats {
  fps: number;
  latency: number;
  handsDetected: number;
}
