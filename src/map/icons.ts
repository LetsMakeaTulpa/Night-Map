import { CATEGORIES } from '../domain/categories';
import { SWATCH } from '../domain/categories';

const SIZE = 72;
const CENTER = SIZE / 2;
const RADIUS = 24;

function drawIcon(ctx: CanvasRenderingContext2D, path: string, color: string) {
  const scale = 27 / 24;
  ctx.save();
  ctx.translate(CENTER, CENTER);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(path));
  ctx.restore();
}

function baseCircle(ctx: CanvasRenderingContext2D, fill: string) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(4, 8, 10, 0.92)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, RADIUS - 1.6, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.stroke();
}

function toImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

export interface MarkerImage {
  id: string;
  data: ImageData;
}

export function buildMarkerImages(): MarkerImage[] {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const images: MarkerImage[] = [];

  for (const category of CATEGORIES) {
    baseCircle(ctx, category.color);
    drawIcon(ctx, category.icon, '#081013');
    images.push({ id: `marker-${category.id}`, data: toImageData(canvas) });
  }

  // Observations: a diamond reads differently from a resource circle at a glance.
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.translate(CENTER, CENTER);
  ctx.rotate(Math.PI / 4);
  const side = 31;
  ctx.fillStyle = SWATCH.observation;
  ctx.strokeStyle = 'rgba(4, 8, 10, 0.92)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(-side / 2, -side / 2, side, side, 4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, 3.4, 0, Math.PI * 2);
  ctx.fillStyle = '#0A1013';
  ctx.fill();
  images.push({ id: 'marker-observation', data: toImageData(canvas) });

  return images;
}

export function buildLocationDot(): MarkerImage {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.beginPath();
  ctx.arc(24, 24, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#EAF4F5';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10, 20, 24, 0.9)';
  ctx.stroke();
  return { id: 'user-location', data: ctx.getImageData(0, 0, 48, 48) };
}
