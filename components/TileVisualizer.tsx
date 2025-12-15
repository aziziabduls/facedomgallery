import React, { useEffect, useRef } from 'react';
import { FaceShape } from '../types';

interface TileVisualizerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  shape: FaceShape;
  index: number; // Used to create slight variations
}

const TileVisualizer: React.FC<TileVisualizerProps> = ({ analyser, isPlaying, shape, index }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  
  useEffect(() => {
    if (analyser && !dataArrayRef.current) {
        const bufferLength = analyser.frequencyBinCount;
        dataArrayRef.current = new Uint8Array(bufferLength);
    }
  }, [analyser]);

  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      if (!analyser || !dataArrayRef.current) {
         // Static fallback if no audio
         ctx.clearRect(0, 0, canvas.width, canvas.height);
         return;
      }

      // If not playing, just clear or show static
      if (!isPlaying) {
         ctx.clearRect(0, 0, canvas.width, canvas.height);
         // Optional: Draw a static line
         ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
         ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
         return;
      }

      analyser.getByteFrequencyData(dataArrayRef.current);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const width = canvas.width;
      const height = canvas.height;
      const bufferLength = dataArrayRef.current.length;
      
      // Use a subset of data for better visuals (low-mid frequencies)
      const dataSubset = Math.floor(bufferLength * 0.6); 
      const step = Math.ceil(dataSubset / 16); // Draw ~16 bars/points

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      
      // Offset the data read index based on tile index to make them look different
      const offset = (index * 5) % 100; 

      if (shape === 'circle') {
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = width / 3;

        ctx.beginPath();
        for (let i = 0; i < dataSubset; i += step) {
            const val = dataArrayRef.current[i + offset] || 0;
            const barHeight = (val / 255) * (width / 3);
            const angle = (i / dataSubset) * Math.PI * 2;
            
            const x = centerX + Math.cos(angle) * (radius + barHeight * 0.5);
            const y = centerY + Math.sin(angle) * (radius + barHeight * 0.5);
            
            // Draw dots or small lines around circle
            ctx.moveTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
            ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // Square/Rect: Draw simple bars
        const barWidth = (width / 10);
        let x = 0;
        
        for (let i = 0; i < 10; i++) {
            // Pick data with offset
            const dataIndex = (i * step + offset) % bufferLength;
            const val = dataArrayRef.current[dataIndex];
            
            const barHeight = (val / 255) * height * 0.8;
            
            // Center vertically
            const y = (height - barHeight) / 2;
            
            ctx.fillStyle = `rgba(100, 200, 255, ${val / 300})`;
            ctx.fillRect(x, y, barWidth - 2, barHeight);
            
            x += barWidth;
        }
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isPlaying, shape, index]);

  return (
    <canvas 
      ref={canvasRef} 
      width={100} 
      height={100} 
      className="w-full h-full opacity-60 pointer-events-none"
    />
  );
};

export default TileVisualizer;