import React, { useRef, useEffect } from 'react';
import { BoundingBox, FaceDisplayConfig } from '../types';

interface FaceCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  boundingBox: BoundingBox;
  id?: string;
  className?: string;
  config?: FaceDisplayConfig;
}

const FaceCanvas: React.FC<FaceCanvasProps> = ({ 
  videoRef, 
  boundingBox, 
  id, 
  className,
  config = { shape: 'square', filter: 'none' } 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use refs for props that change every frame to avoid restarting the effect loop
  const boxRef = useRef(boundingBox);
  const idRef = useRef(id);

  useEffect(() => {
    boxRef.current = boundingBox;
    idRef.current = id;
  }, [boundingBox, id]);

  useEffect(() => {
    let animationFrameId: number;

    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && !video.paused && !video.ended) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const box = boxRef.current;
          const currentId = idRef.current;

          // Add some padding to the crop
          const padding = box.width * 0.4;
          const sx = Math.max(0, box.originX - padding);
          const sy = Math.max(0, box.originY - padding);
          const sWidth = Math.min(video.videoWidth - sx, box.width + (padding * 2));
          const sHeight = Math.min(video.videoHeight - sy, box.height + (padding * 2));

          canvas.width = sWidth;
          canvas.height = sHeight;

          // Mirror detection is usually needed for webcam (user facing), 
          // but for uploaded video we might not want mirror. 
          // However, consistency in the dome is usually preferred.
          // Let's keep the mirror effect for the dome aesthetic.
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);

          ctx.drawImage(
            video,
            sx,
            sy,
            sWidth,
            sHeight,
            0,
            0,
            canvas.width,
            canvas.height
          );
          
          ctx.restore();

          // Draw Tracking ID Overlay (Subtle)
          if (currentId) {
            const fontSize = Math.max(10, Math.floor(canvas.width * 0.12));
            ctx.font = `500 ${fontSize}px sans-serif`;
            
            const text = `${currentId}`;
            const metrics = ctx.measureText(text);
            
            const padX = fontSize * 0.5;
            const padY = fontSize * 0.25;
            
            // Positioning: Bottom Right with small offset
            const x = canvas.width - metrics.width - padX * 2 - 4;
            const y = canvas.height - fontSize - padY * 2 - 4;
            
            // Draw subtle semi-transparent pill background
            ctx.fillStyle = "rgba(0, 0, 0, 0.4)"; 
            ctx.beginPath();
            ctx.roundRect(
                x, 
                y, 
                metrics.width + padX * 2, 
                fontSize + padY * 2, 
                6
            );
            ctx.fill();
            
            // Draw text
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.textBaseline = 'top';
            ctx.fillText(
                text, 
                x + padX, 
                y + padY + (fontSize * 0.05)
            );
          }
        }
      }
      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [videoRef]);

  // Compute CSS styles based on config
  const getFilterStyle = () => {
    switch (config.filter) {
      case 'grayscale': return 'grayscale(100%)';
      case 'sepia': return 'sepia(100%)';
      case 'invert': return 'invert(100%)';
      case 'contrast': return 'contrast(150%) saturate(0)';
      default: return 'none';
    }
  };

  const getShapeStyle = () => {
    return config.shape === 'circle' ? '50%' : '12px'; // Default radius matches parent usually, but we override here
  };

  return (
    <canvas
      ref={canvasRef}
      className={className || "w-full h-full object-cover block"}
      style={{
        filter: getFilterStyle(),
        borderRadius: getShapeStyle(),
        transition: 'filter 0.3s ease, border-radius 0.3s ease'
      }}
    />
  );
};

export default FaceCanvas;