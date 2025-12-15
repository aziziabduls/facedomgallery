import React, { useEffect, useRef, useState } from 'react';
import { initializeFaceDetector, detectFaces } from './services/faceDetectionService';
import { DetectedFace, BoundingBox } from './types';
import DomeGallery from './components/DomeGallery';

// Import Lucide icons
import { Camera, Loader2, AlertCircle } from 'lucide-react';

// Simple 1D Kalman Filter for smoothing coordinates
class SimpleKalmanFilter {
  x: number;
  p: number; // estimation error covariance
  q: number; // process noise covariance
  r: number; // measurement noise covariance
  k: number; // kalman gain

  constructor(initialValue: number, q: number = 2, r: number = 10) {
    this.x = initialValue;
    this.p = 1.0;
    this.q = q;
    this.r = r;
    this.k = 0;
  }

  update(measurement: number): number {
    // Prediction update
    this.p = this.p + this.q;

    // Measurement update
    this.k = this.p / (this.p + this.r);
    this.x = this.x + this.k * (measurement - this.x);
    this.p = (1 - this.k) * this.p;

    return this.x;
  }
}

interface TrackedFaceData {
  id: string;
  lastSeen: number;
  filters: {
    x: SimpleKalmanFilter;
    y: SimpleKalmanFilter;
    w: SimpleKalmanFilter;
    h: SimpleKalmanFilter;
  };
  score: number;
  // Store current smoothed values
  currentBox: BoundingBox; 
}

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faces, setFaces] = useState<DetectedFace[]>([]);
  const lastVideoTimeRef = useRef<number>(-1);
  const animationFrameRef = useRef<number>(0);
  
  // Tracking Refs
  const nextFaceIdRef = useRef<number>(1);
  const trackedFacesRef = useRef<TrackedFaceData[]>([]);

  // Setup Camera and Model
  useEffect(() => {
    const setup = async () => {
      try {
        setIsInitializing(true);
        // 1. Initialize MediaPipe
        await initializeFaceDetector();

        // 2. Setup Webcam
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: "user"
            }
          });
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            // Wait for video to load metadata to start detection loop
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play();
              startDetectionLoop();
            };
          }
        } else {
          setError("Webcam access not supported in this browser.");
        }
      } catch (err) {
        console.error(err);
        setError("Failed to initialize camera or AI model. Please check permissions and connection.");
      } finally {
        setIsInitializing(false);
      }
    };

    setup();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startDetectionLoop = () => {
    const loop = () => {
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          
          const now = performance.now();
          const detections = detectFaces(video, now);
          
          if (detections && detections.detections) {
            const rawDetections = detections.detections.map(det => ({
              score: det.categories[0].score,
              box: {
                originX: det.boundingBox?.originX ?? 0,
                originY: det.boundingBox?.originY ?? 0,
                width: det.boundingBox?.width ?? 0,
                height: det.boundingBox?.height ?? 0,
              }
            }));
            
            // 1. Clean up old tracks (timeout > 500ms)
            trackedFacesRef.current = trackedFacesRef.current.filter(t => now - t.lastSeen < 500);

            const usedDetectionIndices = new Set<number>();
            const activeFaces: DetectedFace[] = [];

            // 2. Match existing tracks to new detections (Greedy Nearest Neighbor)
            // We use the *predicted* (last smoothed) position for matching
            trackedFacesRef.current.forEach(track => {
              let bestIdx = -1;
              let bestDist = Infinity;
              const tBox = track.currentBox;
              const tCx = tBox.originX + tBox.width / 2;
              const tCy = tBox.originY + tBox.height / 2;

              rawDetections.forEach((det, idx) => {
                if (usedDetectionIndices.has(idx)) return;
                
                const dCx = det.box.originX + det.box.width / 2;
                const dCy = det.box.originY + det.box.height / 2;
                const dist = Math.hypot(dCx - tCx, dCy - tCy);

                // Threshold: movement less than 1.5x width roughly
                const threshold = Math.max(tBox.width, det.box.width) * 1.5;

                if (dist < threshold && dist < bestDist) {
                  bestDist = dist;
                  bestIdx = idx;
                }
              });

              if (bestIdx !== -1) {
                // Matched: Update filters
                const match = rawDetections[bestIdx];
                usedDetectionIndices.add(bestIdx);
                
                track.lastSeen = now;
                track.score = match.score;
                
                // Update Kalman filters
                const smX = track.filters.x.update(match.box.originX);
                const smY = track.filters.y.update(match.box.originY);
                const smW = track.filters.w.update(match.box.width);
                const smH = track.filters.h.update(match.box.height);

                track.currentBox = {
                    originX: smX,
                    originY: smY,
                    width: smW,
                    height: smH
                };

                activeFaces.push({
                  id: track.id,
                  boundingBox: track.currentBox,
                  score: track.score
                });
              }
            });

            // 3. Create new tracks for unmatched detections
            rawDetections.forEach((det, idx) => {
              if (usedDetectionIndices.has(idx)) return;

              const newId = `${nextFaceIdRef.current++}`;
              // Initialize filters
              // Q=2 (Process Noise - reactivity), R=15 (Measurement Noise - smoothness)
              // Tuning: Higher R = smoother but more lag. Lower R = jittery but fast.
              const filters = {
                x: new SimpleKalmanFilter(det.box.originX, 2, 15),
                y: new SimpleKalmanFilter(det.box.originY, 2, 15),
                w: new SimpleKalmanFilter(det.box.width, 1, 15), // Width changes slower usually
                h: new SimpleKalmanFilter(det.box.height, 1, 15),
              };

              // Initial update to stabilize covariance
              filters.x.update(det.box.originX);
              filters.y.update(det.box.originY);
              filters.w.update(det.box.width);
              filters.h.update(det.box.height);

              const newTrack: TrackedFaceData = {
                id: newId,
                lastSeen: now,
                filters,
                score: det.score,
                currentBox: det.box
              };

              trackedFacesRef.current.push(newTrack);
              activeFaces.push({
                id: newId,
                boundingBox: det.box,
                score: det.score
              });
            });

            // Only update state if we have faces or if we cleared faces
            // We sort by ID to keep order somewhat stable in DOM if needed, 
            // though DomeGallery handles positioning.
            setFaces(activeFaces);
          }
        }
      }
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  return (
    <div className="h-screen w-screen bg-black flex flex-col items-center justify-center overflow-hidden font-sans">
      
      {/* Header */}
      <header className="absolute top-0 left-0 w-full p-6 z-20 flex justify-between items-center pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-indigo-600/20 backdrop-blur p-2 rounded-lg border border-indigo-500/30">
             <Camera className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white/90 tracking-tight">FaceDome</h1>
          </div>
        </div>
        
        {isInitializing && (
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/80 backdrop-blur rounded-full text-xs border border-white/10">
            <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
            <span className="text-slate-400">Loading AI...</span>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="relative w-full h-full">
        
        {/* Hidden Source Video */}
        <video 
          ref={videoRef}
          className="absolute opacity-0 pointer-events-none"
          playsInline
          muted
        />

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
            <div className="bg-slate-900 border border-red-500/20 p-8 rounded-2xl max-w-md text-center backdrop-blur-sm">
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">System Error</h3>
              <p className="text-slate-400 text-sm mb-6">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors text-sm font-medium"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <DomeGallery faces={faces} videoRef={videoRef} />
        )}
      </main>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center pointer-events-none opacity-50">
        <p className="text-[10px] text-white/40 tracking-[0.2em] uppercase">
          Drag to Rotate • {faces.length} Detected
        </p>
      </div>

    </div>
  );
};

export default App;