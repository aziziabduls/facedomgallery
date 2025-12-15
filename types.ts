export interface BoundingBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface DetectedFace {
  id: string; // Unique ID for tracking (simplified for this demo)
  boundingBox: BoundingBox;
  score: number;
}

export interface FaceDetectorConfig {
  minDetectionConfidence: number;
  minSuppressionThreshold: number;
}

export type FaceShape = 'square' | 'circle';
export type FaceFilter = 'none' | 'grayscale' | 'sepia' | 'invert' | 'contrast';

export interface FaceDisplayConfig {
  shape: FaceShape;
  filter: FaceFilter;
}