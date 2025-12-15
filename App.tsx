import React, { useEffect, useRef, useState } from 'react';
import { initializeFaceDetector, detectFaces } from './services/faceDetectionService';
import { DetectedFace, BoundingBox, FaceDisplayConfig, FaceShape, FaceFilter } from './types';
import DomeGallery from './components/DomeGallery';

// Import Lucide icons
import { Camera, Loader2, AlertCircle, Settings2, Upload, Video, X, ChevronDown, Music, Play, Pause } from 'lucide-react';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faces, setFaces] = useState<DetectedFace[]>([]);
  
  const [sourceType, setSourceType] = useState<'webcam' | 'upload'>('webcam');
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  
  // Camera Device State
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  // Audio State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  // Force update to pass analyser down initially
  const [, setForceUpdate] = useState(0);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  const [config, setConfig] = useState<FaceDisplayConfig>({
    shape: 'square',
    filter: 'none'
  });

  const lastVideoTimeRef = useRef<number>(-1);
  const animationFrameRef = useRef<number>(0);
  
  // Tracking Refs
  const nextFaceIdRef = useRef<number>(1);
  const trackedFacesRef = useRef<TrackedFaceData[]>([]);

  // Initialize Audio
  useEffect(() => {
    // Setup Audio Context
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    audioContextRef.current = ctx;
    
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;

    const audioEl = new Audio();
    audioEl.loop = true;
    audioElementRef.current = audioEl;

    // Connect Source -> Analyser -> Destination
    const source = ctx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    sourceNodeRef.current = source;

    setForceUpdate(n => n + 1); // Trigger render to pass analyser

    return () => {
       ctx.close();
    };
  }, []);

  // Setup Camera/Video and Model
  useEffect(() => {
    const setup = async () => {
      try {
        setIsInitializing(true);
        // 1. Initialize MediaPipe
        await initializeFaceDetector();

        // 2. Setup Input Source
        await setupSource();

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
      if (videoRef.current) {
         const stream = videoRef.current.srcObject as MediaStream;
         if (stream) stream.getTracks().forEach(track => track.stop());
      }
    };
    // Re-run setup if source type, uploaded url, or SPECIFIC CAMERA ID changes
  }, [sourceType, uploadedVideoUrl, selectedDeviceId]);

  const setupSource = async () => {
     if (!videoRef.current) return;

     // Stop existing stream if any
     if (videoRef.current.srcObject) {
       const stream = videoRef.current.srcObject as MediaStream;
       stream.getTracks().forEach(track => track.stop());
       videoRef.current.srcObject = null;
     }
     
     if (sourceType === 'webcam') {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            // Determine constraints based on selected device
            const constraints: MediaStreamConstraints = {
                audio: false,
                video: selectedDeviceId 
                  ? { 
                      deviceId: { exact: selectedDeviceId },
                      width: { ideal: 1280 },
                      height: { ideal: 720 }
                    }
                  : { 
                      facingMode: "user",
                      width: { ideal: 1280 },
                      height: { ideal: 720 }
                    }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            videoRef.current.srcObject = stream;
            videoRef.current.removeAttribute('src'); // clear blob src
            
            // After successful stream, enumerate devices to populate the list
            // (Browser requires permission before labels are available)
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const videoDevs = allDevices.filter(d => d.kind === 'videoinput');
            setDevices(videoDevs);

            // If no device selected yet, but we have a stream, try to sync state
            if (!selectedDeviceId && videoDevs.length > 0) {
                const track = stream.getVideoTracks()[0];
                const capabilities = track.getCapabilities ? track.getCapabilities() : {};
                // If we can identify the current device ID from the stream, set it
                if (capabilities.deviceId) {
                    setSelectedDeviceId(capabilities.deviceId);
                }
            }

          } catch (e) {
            console.error("Camera access error:", e);
            setError("Could not access camera. Please check permissions.");
          }
        } else {
            setError("Webcam access not supported in this browser.");
        }
     } else if (sourceType === 'upload' && uploadedVideoUrl) {
         videoRef.current.src = uploadedVideoUrl;
         videoRef.current.loop = true;
     }

     videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(e => console.log("Autoplay blocked", e));
        // Reset tracking when source changes
        trackedFacesRef.current = [];
        nextFaceIdRef.current = 1;
        startDetectionLoop();
     };
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
          const url = URL.createObjectURL(file);
          setUploadedVideoUrl(url);
          setSourceType('upload');
          setIsSettingsOpen(false);
      }
  };

  const handleAudioUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file && audioElementRef.current) {
          const url = URL.createObjectURL(file);
          audioElementRef.current.src = url;
          setAudioUrl(file.name);
          setIsMusicPlaying(false); // Reset play state
      }
  };

  const toggleMusic = () => {
      if (!audioElementRef.current || !audioContextRef.current) return;
      
      // Resume context if suspended (browser policy)
      if (audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume();
      }

      if (isMusicPlaying) {
          audioElementRef.current.pause();
          setIsMusicPlaying(false);
      } else {
          // Only play if src is set
          if (audioElementRef.current.src) {
            audioElementRef.current.play();
            setIsMusicPlaying(true);
          } else {
             // Maybe prompt user to upload music
             setIsSettingsOpen(true);
          }
      }
  };

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

            // 2. Match existing tracks to new detections
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
                // Matched
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
              const filters = {
                x: new SimpleKalmanFilter(det.box.originX, 2, 15),
                y: new SimpleKalmanFilter(det.box.originY, 2, 15),
                w: new SimpleKalmanFilter(det.box.width, 1, 15), 
                h: new SimpleKalmanFilter(det.box.height, 1, 15),
              };

              // Initial update
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
        
        <div className="flex items-center gap-3 pointer-events-auto">
           {isInitializing && (
             <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/80 backdrop-blur rounded-full text-xs border border-white/10">
               <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
               <span className="text-slate-400">Loading AI...</span>
             </div>
           )}
           
           {/* Music Play/Pause Control */}
           <button 
             onClick={toggleMusic}
             className={`p-2 rounded-full transition-colors backdrop-blur border ${isMusicPlaying ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-white/10 text-white/80 border-white/5 hover:bg-white/20'}`}
             title={audioUrl ? `Playing: ${audioUrl}` : "Upload music in settings"}
           >
              {isMusicPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
           </button>

           <button 
             onClick={() => setIsSettingsOpen(true)}
             className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors backdrop-blur border border-white/5"
           >
              <Settings2 className="w-5 h-5 text-white/80" />
           </button>
        </div>
      </header>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
           <div className="bg-slate-900 border border-indigo-500/20 w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              
              <h2 className="text-xl font-bold text-white mb-6">Settings</h2>
              
              {/* Source Section */}
              <div className="mb-6">
                <label className="text-xs text-slate-400 uppercase font-semibold tracking-wider mb-3 block">Input Source</label>
                <div className="grid grid-cols-2 gap-3 mb-3">
                   <button 
                     onClick={() => { setSourceType('webcam'); }}
                     className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all ${sourceType === 'webcam' ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-white/5 border-transparent text-slate-400 hover:bg-white/10'}`}
                   >
                     <Video className="w-6 h-6" />
                     <span className="text-sm">Webcam</span>
                   </button>
                   
                   <button 
                     onClick={() => fileInputRef.current?.click()}
                     className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all ${sourceType === 'upload' ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-white/5 border-transparent text-slate-400 hover:bg-white/10'}`}
                   >
                     <Upload className="w-6 h-6" />
                     <span className="text-sm">Upload Video</span>
                   </button>
                   <input 
                     type="file" 
                     accept="video/*" 
                     className="hidden" 
                     ref={fileInputRef}
                     onChange={handleFileUpload}
                   />
                </div>

                {/* Camera Selection Dropdown (Only shows if webcam selected and multiple devices exist) */}
                {sourceType === 'webcam' && devices.length > 0 && (
                   <div className="relative">
                      <select 
                        value={selectedDeviceId}
                        onChange={(e) => setSelectedDeviceId(e.target.value)}
                        className="w-full appearance-none bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg pl-3 pr-10 py-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                      >
                         {devices.map((device) => (
                           <option key={device.deviceId} value={device.deviceId}>
                             {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                           </option>
                         ))}
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-slate-400">
                        <ChevronDown className="w-4 h-4" />
                      </div>
                   </div>
                )}
              </div>

              {/* Music Section */}
              <div className="mb-6">
                <label className="text-xs text-slate-400 uppercase font-semibold tracking-wider mb-3 block">Background Music</label>
                <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 rounded-full">
                       <Music className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                       <p className="text-sm text-white truncate">{audioUrl || "No music selected"}</p>
                       <p className="text-xs text-slate-400">MP3, WAV</p>
                    </div>
                    <button 
                       onClick={() => audioInputRef.current?.click()}
                       className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs text-white transition-colors"
                    >
                       Choose
                    </button>
                    <input 
                       type="file" 
                       accept="audio/*" 
                       className="hidden" 
                       ref={audioInputRef}
                       onChange={handleAudioUpload}
                    />
                </div>
              </div>

              {/* Shape Section */}
              <div className="mb-6">
                 <label className="text-xs text-slate-400 uppercase font-semibold tracking-wider mb-3 block">Face Shape</label>
                 <div className="flex gap-2">
                    {(['square', 'circle'] as FaceShape[]).map(shape => (
                        <button
                          key={shape}
                          onClick={() => setConfig(prev => ({ ...prev, shape }))}
                          className={`flex-1 py-2 px-3 rounded-lg text-sm border transition-all capitalize ${config.shape === shape ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-white/5 text-slate-400 border-transparent hover:bg-white/10'}`}
                        >
                          {shape}
                        </button>
                    ))}
                 </div>
              </div>

              {/* Effects Section */}
              <div className="mb-2">
                 <label className="text-xs text-slate-400 uppercase font-semibold tracking-wider mb-3 block">Effect / Filter</label>
                 <div className="grid grid-cols-3 gap-2">
                    {(['none', 'grayscale', 'sepia', 'invert', 'contrast'] as FaceFilter[]).map(filter => (
                        <button
                          key={filter}
                          onClick={() => setConfig(prev => ({ ...prev, filter }))}
                          className={`py-2 px-2 rounded-lg text-xs border transition-all capitalize ${config.filter === filter ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-white/5 text-slate-400 border-transparent hover:bg-white/10'}`}
                        >
                          {filter}
                        </button>
                    ))}
                 </div>
              </div>

           </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="relative w-full h-full">
        
        {/* Hidden Source Video (plays inline, muted, handles both webcam and blob) */}
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
          <DomeGallery 
             faces={faces} 
             videoRef={videoRef} 
             config={config} 
             grayscale={false}
             analyser={analyserRef.current}
             isMusicPlaying={isMusicPlaying}
          />
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