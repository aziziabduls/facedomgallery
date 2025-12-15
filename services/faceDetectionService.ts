import { FilesetResolver, FaceDetector, FaceDetectorResult } from '@mediapipe/tasks-vision';

let faceDetector: FaceDetector | null = null;

export const initializeFaceDetector = async (): Promise<void> => {
  if (faceDetector) return;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  );

  // Configure delegate:
  // "GPU" delegate maps to Metal on Apple Silicon and WebGL on non-Apple devices.
  try {
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
        delegate: "GPU"
      },
      runningMode: "VIDEO"
    });
  } catch (error) {
    console.warn("Failed to initialize with GPU delegate, falling back to CPU.", error);
    // Fallback to CPU if GPU (Metal/WebGL) is unavailable
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
        delegate: "CPU"
      },
      runningMode: "VIDEO"
    });
  }
};

export const detectFaces = (video: HTMLVideoElement, startTimeMs: number): FaceDetectorResult | null => {
  if (!faceDetector) return null;
  return faceDetector.detectForVideo(video, startTimeMs);
};
