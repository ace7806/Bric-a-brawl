import { assert, assertFinite, InvariantError } from '@sim/assert';
import { getFighterSpec } from '@sim/data';
import { ErrorCode, FighterId } from '@sim/enums';

export const PHOTO_WIDTH = 1200;
export const PHOTO_HEIGHT = 630;

const DELFT_INK = '#1E3A8A';
const BONE_PAPER = '#F6F2E9';
const OXBLOOD_STAMP = '#A3312B';
const GILT_ACCENT = '#C8A24A';
const INK_DARK = '#2B2623';
const INK_SOFT = '#6B625A';

export interface PhotoRow {
  readonly name: string;
  readonly fighterLabel: string;
  readonly score: number;
  readonly statusLine: string;
}

export interface PhotoCaptureInput {
  readonly sourceCanvas: HTMLCanvasElement | null;
  readonly winnerName: string;
  readonly winnerFighter: FighterId;
  readonly arenaName: string;
  readonly roundNumber: number;
  readonly causeLine: string;
  readonly durationSec: number;
  readonly rows: readonly PhotoRow[];
}

export interface SessionCardRow {
  readonly rank: number;
  readonly name: string;
  readonly fighterLabel: string;
  readonly wins: number;
  readonly appraisalLine: string;
}

function createCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  assert(typeof document !== 'undefined', ErrorCode.MissingRequiredEntry, 'document unavailable for canvas creation');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  assert(ctx !== null, ErrorCode.InvariantViolation, '2D canvas context unavailable');
  return { canvas, ctx };
}

function drawCatalogueFrame(ctx: CanvasRenderingContext2D, accentColor: string): void {
  ctx.fillStyle = BONE_PAPER;
  ctx.fillRect(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  ctx.strokeStyle = DELFT_INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, PHOTO_WIDTH - 44, PHOTO_HEIGHT - 44);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(30, 30, PHOTO_WIDTH - 60, PHOTO_HEIGHT - 60);

  for (const [cx, cy] of [[30, 30], [PHOTO_WIDTH - 30, 30], [30, PHOTO_HEIGHT - 30], [PHOTO_WIDTH - 30, PHOTO_HEIGHT - 30]] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = BONE_PAPER;
    ctx.fill();
    ctx.strokeStyle = DELFT_INK;
    ctx.stroke();
  }
}

function drawSoldStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, label = 'SOLD!'): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.19);
  ctx.strokeStyle = OXBLOOD_STAMP;
  ctx.fillStyle = 'rgba(246, 242, 233, 0.88)';
  ctx.lineWidth = 4;
  ctx.fillRect(-74, -26, 148, 52);
  ctx.strokeRect(-74, -26, 148, 52);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-68, -20, 136, 40);
  ctx.fillStyle = OXBLOOD_STAMP;
  ctx.font = '900 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 2);
  ctx.restore();
}

function drawPorcelainFallbackPlate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fighterName: string): void {
  ctx.fillStyle = BONE_PAPER;
  ctx.fillRect(x, y, w, h);
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const r = Math.min(w, h) * 0.36;

  ctx.save();
  ctx.strokeStyle = DELFT_INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = DELFT_INK;
  ctx.font = '900 42px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('B · B', cx, cy - 8);
  ctx.font = '700 13px "Courier New", monospace';
  ctx.fillText(fighterName.toUpperCase(), cx, cy + 28);
  ctx.restore();
}

function drawDelftTransferPlate(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  fighterName: string,
): void {
  if (source === null || source.width <= 0 || source.height <= 0) {
    drawPorcelainFallbackPlate(ctx, x, y, w, h, fighterName);
    return;
  }
  const scratch = createCanvas(w, h);
  const sctx = scratch.ctx;
  const scale = Math.max(w / source.width, h / source.height);
  const dw = source.width * scale;
  const dh = source.height * scale;
  sctx.drawImage(source, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh);

  const img = sctx.getImageData(0, 0, w, h);
  const data = img.data;
  let minLum = 255;
  let maxLum = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }
  if (maxLum - minLum < 4) {
    drawPorcelainFallbackPlate(ctx, x, y, w, h, fighterName);
    return;
  }

  const span = maxLum - minLum;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0) {
      data[i] = 246;
      data[i + 1] = 242;
      data[i + 2] = 233;
      data[i + 3] = 255;
      continue;
    }
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    const t = Math.min(1, Math.max(0, Math.pow((lum - minLum) / span, 0.92)));
    data[i] = Math.round(30 + 216 * t);
    data[i + 1] = Math.round(58 + 184 * t);
    data[i + 2] = Math.round(138 + 95 * t);
    data[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.drawImage(scratch.canvas, x, y);
}

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number): number {
  const words = text.trim().split(/\s+/);
  let line = '';
  let curY = y;
  let lines = 0;
  for (const word of words) {
    const test = line.length === 0 ? word : `${line} ${word}`;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, curY);
      curY += lineHeight;
      lines++;
      if (lines >= maxLines) return curY;
      line = word;
    } else {
      line = test;
    }
  }
  if (line.length > 0 && lines < maxLines) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

export function renderResultsPhotoCanvas(input: PhotoCaptureInput): HTMLCanvasElement {
  assert(Number.isInteger(input.roundNumber) && input.roundNumber >= 1, ErrorCode.InvariantViolation, `Invalid roundNumber: ${input.roundNumber}`);
  assertFinite(input.durationSec, 'durationSec');
  const { canvas, ctx } = createCanvas(PHOTO_WIDTH, PHOTO_HEIGHT);
  drawCatalogueFrame(ctx, DELFT_INK);

  const fighterName = getFighterSpec(input.winnerFighter).name;
  ctx.fillStyle = DELFT_INK;
  ctx.font = '700 16px "Courier New", monospace';
  ctx.fillText(`LOT ${input.roundNumber} — BRIC-A-BRAWL`, 48, 66);
  ctx.textAlign = 'right';
  ctx.fillStyle = INK_SOFT;
  ctx.font = '700 14px "Courier New", monospace';
  ctx.fillText('THE MANTEL AUCTION ROOMS', PHOTO_WIDTH - 48, 66);
  ctx.textAlign = 'left';

  ctx.strokeStyle = DELFT_INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(48, 82);
  ctx.lineTo(PHOTO_WIDTH - 48, 82);
  ctx.stroke();

  const [px, py, pw, ph] = [48, 102, 684, 430];
  drawDelftTransferPlate(ctx, input.sourceCanvas, px, py, pw, ph, fighterName);
  ctx.strokeStyle = DELFT_INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 5, py + 5, pw - 10, ph - 10);
  drawSoldStamp(ctx, px + pw - 74, py + 44);

  const [rx, rw] = [758, 394];
  ctx.fillStyle = INK_SOFT;
  ctx.font = '700 13px "Courier New", monospace';
  ctx.fillText('HAMMER FALLS TO', rx, 120);
  ctx.fillStyle = DELFT_INK;
  ctx.font = '900 34px Georgia, serif';
  ctx.fillText(input.winnerName.slice(0, 22), rx, 158);
  ctx.fillStyle = INK_DARK;
  ctx.font = 'italic 18px Georgia, serif';
  ctx.fillText(`${fighterName} · Plate ${input.roundNumber}`, rx, 188);

  ctx.fillStyle = INK_SOFT;
  ctx.font = '15px "Courier New", monospace';
  const afterCauseY = drawWrappedText(ctx, input.causeLine, rx, 224, rw, 20, 3);

  let rowY = Math.max(292, afterCauseY + 14);
  ctx.strokeStyle = DELFT_INK;
  ctx.beginPath();
  ctx.moveTo(rx, rowY - 14);
  ctx.lineTo(rx + rw, rowY - 14);
  ctx.stroke();

  for (const row of input.rows.slice(0, 5)) {
    ctx.fillStyle = INK_DARK;
    ctx.font = '700 15px Georgia, serif';
    ctx.fillText(`${row.name} (${row.fighterLabel})`, rx, rowY + 8);
    ctx.textAlign = 'right';
    ctx.font = '700 14px "Courier New", monospace';
    ctx.fillText(`${row.score} pts`, rx + rw, rowY + 8);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK_SOFT;
    ctx.font = '13px "Courier New", monospace';
    ctx.fillText(row.statusLine.slice(0, 44), rx, rowY + 28);
    rowY += 46;
  }

  ctx.strokeStyle = DELFT_INK;
  ctx.beginPath();
  ctx.moveTo(48, 554);
  ctx.lineTo(PHOTO_WIDTH - 48, 554);
  ctx.stroke();
  ctx.fillStyle = INK_SOFT;
  ctx.font = '700 14px "Courier New", monospace';
  ctx.fillText(`${input.arenaName.toUpperCase()} · ${Math.max(0, Math.round(input.durationSec))}S`, 48, 582);
  ctx.textAlign = 'right';
  ctx.fillText('FINE BONE OF CONTENTION', PHOTO_WIDTH - 48, 582);
  ctx.textAlign = 'left';
  return canvas;
}

export function renderSessionCardCanvas(winnerName: string, rows: readonly SessionCardRow[]): HTMLCanvasElement {
  assert(winnerName.trim().length > 0, ErrorCode.InvariantViolation, 'renderSessionCardCanvas requires winnerName');
  const { canvas, ctx } = createCanvas(PHOTO_WIDTH, PHOTO_HEIGHT);
  drawCatalogueFrame(ctx, GILT_ACCENT);

  ctx.fillStyle = DELFT_INK;
  ctx.font = '700 15px "Courier New", monospace';
  ctx.fillText('AUCTION CATALOGUE — SESSION SUMMARY', 52, 66);
  ctx.textAlign = 'right';
  ctx.fillText('BRIC-A-BRAWL', PHOTO_WIDTH - 52, 66);
  ctx.textAlign = 'left';

  ctx.fillStyle = INK_SOFT;
  ctx.font = '700 13px "Courier New", monospace';
  ctx.fillText('CHAMPION OF THE EVENING SALE', 52, 108);
  ctx.fillStyle = DELFT_INK;
  ctx.font = '900 44px Georgia, serif';
  ctx.fillText(winnerName.slice(0, 28), 52, 154);
  drawSoldStamp(ctx, PHOTO_WIDTH - 140, 128, 'TOP LOT');

  ctx.strokeStyle = DELFT_INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(52, 178);
  ctx.lineTo(PHOTO_WIDTH - 52, 178);
  ctx.stroke();

  let y = 216;
  for (const row of rows.slice(0, 6)) {
    ctx.fillStyle = DELFT_INK;
    ctx.font = '900 22px Georgia, serif';
    ctx.fillText(`#${row.rank}`, 52, y);
    ctx.fillStyle = INK_DARK;
    ctx.font = '700 20px Georgia, serif';
    ctx.fillText(`${row.name} · ${row.fighterLabel}`, 110, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = OXBLOOD_STAMP;
    ctx.font = '700 17px "Courier New", monospace';
    ctx.fillText(`${row.wins} WIN${row.wins === 1 ? '' : 'S'}`, PHOTO_WIDTH - 52, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK_SOFT;
    ctx.font = 'italic 15px Georgia, serif';
    ctx.fillText(row.appraisalLine.slice(0, 96), 110, y + 22);
    ctx.strokeStyle = 'rgba(30, 58, 138, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(52, y + 34);
    ctx.lineTo(PHOTO_WIDTH - 52, y + 34);
    ctx.stroke();
    y += 56;
  }

  ctx.fillStyle = INK_SOFT;
  ctx.font = '700 13px "Courier New", monospace';
  ctx.fillText('THE MANTEL POTTERY · EVENING SALE PROVENANCE', 52, 582);
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new InvariantError(ErrorCode.InvariantViolation, 'canvas.toBlob returned null'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}
