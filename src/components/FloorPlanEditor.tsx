import { useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import type { Wall, Room, Point } from '../lib/shared';

export function FloorPlanEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { processedPlan, showGrid } = useStore();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !processedPlan) return;

    const { walls, rooms } = processedPlan;

    // Clear canvas
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    if (showGrid !== false) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }

    // Calculate bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    walls.forEach((w: Wall) => {
      minX = Math.min(minX, w.startPoint.x, w.endPoint.x);
      minY = Math.min(minY, w.startPoint.y, w.endPoint.y);
      maxX = Math.max(maxX, w.startPoint.x, w.endPoint.x);
      maxY = Math.max(maxY, w.startPoint.y, w.endPoint.y);
    });

    const padding = 30;
    const scaleX = (canvas.width - padding * 2) / (maxX - minX || 1);
    const scaleY = (canvas.height - padding * 2) / (maxY - minY || 1);
    const scale = Math.min(scaleX, scaleY, 1);
    const offsetX = (canvas.width - (maxX - minX) * scale) / 2 - minX * scale;
    const offsetY = (canvas.height - (maxY - minY) * scale) / 2 - minY * scale;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Draw rooms
    const colors: Record<string, string> = {
      living: 'rgba(59, 130, 246, 0.15)',
      bedroom: 'rgba(139, 92, 246, 0.15)',
      kitchen: 'rgba(245, 158, 11, 0.15)',
      bathroom: 'rgba(6, 182, 212, 0.15)',
    };

    rooms.forEach((room: Room) => {
      if (room.polygon.length < 3) return;
      ctx.beginPath();
      ctx.moveTo(room.polygon[0].x, room.polygon[0].y);
      room.polygon.forEach((p: Point) => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = colors[room.type] || 'rgba(148, 163, 184, 0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = 2 / scale;
      ctx.stroke();

      // Room label
      let cx = 0, cy = 0;
      room.polygon.forEach((p: Point) => { cx += p.x; cy += p.y; });
      cx /= room.polygon.length;
      cy /= room.polygon.length;
      ctx.font = `${14 / scale}px Inter, sans-serif`;
      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.name, cx, cy);
    });

    // Draw walls
    walls.forEach((wall: Wall) => {
      ctx.beginPath();
      ctx.moveTo(wall.startPoint.x, wall.startPoint.y);
      ctx.lineTo(wall.endPoint.x, wall.endPoint.y);
      ctx.strokeStyle = wall.type === 'exterior' ? '#374151' : '#6B7280';
      ctx.lineWidth = Math.max(wall.thickness * scale, 6);
      ctx.lineCap = 'round';
      ctx.stroke();
    });

    ctx.restore();
  }, [processedPlan, showGrid]);

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div ref={containerRef} className="flex-1 relative">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
