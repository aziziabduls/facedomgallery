import React, { useEffect, useRef, useState } from 'react';
import { initializeFaceDetector, detectFaces } from './services/faceDetectionService';
import { DetectedFace, BoundingBox } from './types';
import DomeGallery from './components/DomeGallery';

// Import Lucide icons
import { Camera, Loader2, AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faces, setFaces] = useState<DetectedFace[]>([]);
  const lastVideoTimeRef = useRef<number>(-1);
  const animationFrameRef = useRef<number>(0);
  
  // Robust Tracking Refs
  const nextFaceIdRef = useRef<number>(1);
  const trackedFacesRef = useRef<Array<{
    id: string;
    lastSeen: number;
    boundingBox: BoundingBox;
  }>>([]);

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
            const currentDets: { box: BoundingBox; score: number }[] = detections.detections.map(det => ({
              score: det.categories[0].score,
              box: {
                originX: det.boundingBox?.originX ?? 0,
                originY: det.boundingBox?.originY ?? 0,
                width: det.boundingBox?.width ?? 0,
                height: det.boundingBox?.height ?? 0,
              }
            }));
            
            // Prune old tracked faces (not seen for > 500ms) to allow re-assignment if they return much later
            trackedFacesRef.current = trackedFacesRef.current.filter(f => now - f.lastSeen < 500);

            const activeFaces: DetectedFace[] = [];
            const usedTrackedIndices = new Set<number>();

            // Match current detections to known tracked faces
            for (const { box, score } of currentDets) {
              let bestMatchIdx = -1;
              let minDist = Infinity;
              
              const cx = box.originX + box.width / 2;
              const cy = box.originY + box.height / 2;
              
              trackedFacesRef.current.forEach((tracked, idx) => {
                if (usedTrackedIndices.has(idx)) return;
                
                const tcx = tracked.boundingBox.originX + tracked.boundingBox.width / 2;
                const tcy = tracked.boundingBox.originY + tracked.boundingBox.height / 2;
                
                const dist = Math.hypot(cx - tcx, cy - tcy);
                
                // Allow movement up to 100% of the face width between frames/gaps
                // This accounts for fast movement or lower frame rates
                const threshold = Math.max(tracked.boundingBox.width, box.width) * 1.2;
                
                if (dist < threshold && dist < minDist) {
                  minDist = dist;
                  bestMatchIdx = idx;
                }
              });

              if (bestMatchIdx !== -1) {
                // Known face: Update tracking info
                const tracked = trackedFacesRef.current[bestMatchIdx];
                tracked.boundingBox = box;
                tracked.lastSeen = now;
                usedTrackedIndices.add(bestMatchIdx);
                
                activeFaces.push({
                  id: tracked.id,
                  boundingBox: box,
                  score
                });
              } else {
                // New face: Start tracking
                const newId = `${nextFaceIdRef.current++}`;
                trackedFacesRef.current.push({
                  id: newId,
                  boundingBox: box,
                  lastSeen: now
                });
                
                activeFaces.push({
                  id: newId,
                  boundingBox: box,
                  score
                });
              }
            }
            
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