import * as THREE from 'three';
import type { OfficeSnapshot, Tone } from '@ara/shared';

/**
 * Canvas-textures voor het kantoor: muurschermen, bureau-chips en zwevende
 * cijfers. Alles wordt lokaal getekend (geen fonts of assets van buiten) en
 * gecachet op inhoud, zodat hertekenen alleen gebeurt als de tekst verandert.
 */
const cache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const TONE_COLORS: Record<Tone, string> = {
  good: '#4ade80',
  bad: '#ff6b6b',
  warn: '#ffb020',
  muted: '#9aa5b1',
  info: '#8ab4ff',
};

function make(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): { texture: THREE.CanvasTexture; aspect: number } {
  const hit = cache.get(key);
  if (hit) return hit;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const entry = { texture, aspect: width / height };
  cache.set(key, entry);
  // Ruime bovengrens: bij heel lang open blijven groeit de cache anders door.
  if (cache.size > 600) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined && oldest !== key) {
      cache.get(oldest)?.texture.dispose();
      cache.delete(oldest);
    }
  }
  return entry;
}

function panelBg(ctx: CanvasRenderingContext2D, w: number, h: number, accent: string): void {
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, 14);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(46, 30, 84, 0.96)');
  grad.addColorStop(1, 'rgba(28, 18, 56, 0.96)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Naamplaatje boven een bureau: "BTC" + "4 setups". */
export function chipTexture(label: string, sub: string, accent: string) {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `700 38px ${FONT}`;
  const labelWidth = measure.measureText(label).width;
  measure.font = `500 24px ${FONT}`;
  const subWidth = measure.measureText(sub).width;
  const width = Math.max(200, Math.ceil(Math.max(labelWidth, subWidth)) + 56);
  return make(`chip|${label}|${sub}|${accent}`, width, 96, (ctx, w, h) => {
    ctx.beginPath();
    ctx.roundRect(3, 3, w - 6, h - 6, 16);
    ctx.fillStyle = 'rgba(18, 12, 38, 0.88)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2eeff';
    ctx.font = `700 38px ${FONT}`;
    ctx.fillText(label, w / 2, 46);
    ctx.fillStyle = 'rgba(215, 205, 255, 0.75)';
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(sub, w / 2, 78);
  });
}

/** Zwevend resultaat boven een bureau (+$55,30 / 3 ritten). */
export function valueTexture(text: string, tone: Tone) {
  return make(`val|${text}|${tone}`, 220, 64, (ctx, w, h) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 40px ${FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(10, 6, 24, 0.85)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = TONE_COLORS[tone];
    ctx.fillText(text, w / 2, h / 2);
  });
}

/** Groot muurscherm: titel, hoofdcijfer, KPI's en de live grafiek. */
export function headlineTexture(office: OfficeSnapshot) {
  const key = `head|${office.project}|${office.headline.value}|${office.headline.delta}|${office.kpis
    .map((k) => k.value)
    .join(',')}|${office.chart.length}|${office.chart[office.chart.length - 1]}`;
  return make(key, 1100, 300, (ctx, w, h) => {
    panelBg(ctx, w, h, 'rgba(150, 120, 255, 0.55)');
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(205, 195, 255, 0.7)';
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(office.title, 34, 44);

    ctx.fillStyle = 'rgba(190, 180, 250, 0.65)';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(office.headline.label, 34, 86);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 66px ${FONT}`;
    ctx.fillText(office.headline.value, 34, 146);
    if (office.headline.delta) {
      ctx.fillStyle = TONE_COLORS[office.headline.tone ?? 'info'];
      ctx.font = `700 30px ${FONT}`;
      ctx.fillText(office.headline.delta, 36, 186);
    }

    // KPI-kolom
    let y = 96;
    for (const kpi of office.kpis) {
      ctx.fillStyle = 'rgba(190, 180, 250, 0.62)';
      ctx.font = `500 19px ${FONT}`;
      ctx.fillText(kpi.label, 400, y);
      ctx.fillStyle = TONE_COLORS[kpi.tone ?? 'info'];
      ctx.font = `700 25px ${FONT}`;
      ctx.fillText(kpi.value, 400, y + 28);
      y += 60;
    }

    // Grafiek rechts
    const cx = 690;
    const cy = 70;
    const cw = w - cx - 40;
    const ch = h - cy - 50;
    const series = office.chart.length > 1 ? office.chart : [0, 0];
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    ctx.beginPath();
    series.forEach((v, i) => {
      const x = cx + (i / (series.length - 1)) * cw;
      const yy = cy + ch - ((v - min) / span) * ch;
      if (i === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    });
    ctx.strokeStyle = '#6ee7ff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineTo(cx + cw, cy + ch);
    ctx.lineTo(cx, cy + ch);
    ctx.closePath();
    ctx.fillStyle = 'rgba(110, 231, 255, 0.14)';
    ctx.fill();
    ctx.fillStyle = 'rgba(190, 180, 250, 0.6)';
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText('laatste metingen', cx, h - 22);
  });
}

/** Zijpaneel met de feitenfeed ("wat er net gebeurd is"). */
export function factsTexture(office: OfficeSnapshot) {
  const key = `facts|${office.project}|${office.facts.map((f) => f.text).join('|')}`;
  return make(key, 620, 360, (ctx, w, h) => {
    panelBg(ctx, w, h, 'rgba(150, 120, 255, 0.45)');
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(205, 195, 255, 0.75)';
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText('FEITEN VAN DE VLOER', 28, 46);
    let y = 92;
    const items = office.facts.length ? office.facts : [{ ts: Date.now(), text: 'nog niets gebeurd', tone: 'muted' as Tone }];
    for (const fact of items.slice(0, 8)) {
      const time = new Date(fact.ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      ctx.fillStyle = TONE_COLORS[fact.tone];
      ctx.fillRect(28, y - 14, 4, 20);
      ctx.fillStyle = 'rgba(180, 170, 240, 0.7)';
      ctx.font = `500 18px ${FONT}`;
      ctx.fillText(time, 44, y);
      ctx.fillStyle = '#efeaff';
      ctx.font = `500 19px ${FONT}`;
      const text = fact.text.length > 42 ? `${fact.text.slice(0, 41)}…` : fact.text;
      ctx.fillText(text, 100, y);
      y += 34;
    }
  });
}

/** Vergaderruimte-scherm met het lopende overleg. */
export function roomTexture(office: OfficeSnapshot) {
  const key = `room|${office.project}|${office.room.messages.map((m) => m.text).join('|')}`;
  return make(key, 640, 400, (ctx, w, h) => {
    panelBg(ctx, w, h, 'rgba(150, 120, 255, 0.45)');
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f0ebff';
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(office.room.name, 26, 44);
    ctx.fillStyle = 'rgba(190, 180, 250, 0.65)';
    ctx.font = `500 17px ${FONT}`;
    ctx.fillText(office.room.status, 26, 70);

    let y = 108;
    for (const msg of office.room.messages.slice(0, 6)) {
      const right = msg.side === 'right';
      const text = msg.text.length > 34 ? `${msg.text.slice(0, 33)}…` : msg.text;
      ctx.font = `500 19px ${FONT}`;
      const tw = ctx.measureText(text).width;
      const bw = tw + 32;
      const bx = right ? w - bw - 26 : 26;
      ctx.beginPath();
      ctx.roundRect(bx, y - 22, bw, 44, 12);
      ctx.fillStyle = right ? 'rgba(130, 100, 230, 0.55)' : 'rgba(70, 50, 130, 0.6)';
      ctx.fill();
      ctx.fillStyle = 'rgba(200, 190, 255, 0.8)';
      ctx.font = `600 14px ${FONT}`;
      ctx.fillText(msg.from, bx + 4, y - 28);
      ctx.fillStyle = '#f4f0ff';
      ctx.font = `500 19px ${FONT}`;
      ctx.fillText(text, bx + 16, y + 5);
      y += 56;
    }
  });
}
