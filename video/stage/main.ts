// Draws the demo at any time t, deterministically: video/render.mjs calls
// window.__seek(t) once per frame and screenshots the result.
import { createWaves } from '../../src/lib/waves';

type Word = { word: string; start: number; end: number };
type Item =
  | { kind: 'label'; text: string; at: number }
  | { kind: 'message'; who: 'user' | 'bot'; at: number; start: number; end: number; words: Word[]; cutAt?: number };
type Timeline = { fps: number; duration: number; items: Item[]; levels: number[] };

const ENTER = 0.35; // seconds for a new item to slide in
const OUTRO = 1.6; // the outro fades in over the last seconds

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

const timeline: Timeline = await (await fetch('./timeline.json')).json();
const chat = document.getElementById('chat')!;
const viewport = document.getElementById('viewport')!;
const outro = document.getElementById('outro')!;
const canvas = document.getElementById('waves') as HTMLCanvasElement;

const waves = createWaves(canvas, { offsetY: -0.36, preserveDrawingBuffer: true });
if (!waves) throw new Error('WebGL unavailable');
waves.setSize(canvas.clientWidth * devicePixelRatio, canvas.clientHeight * devicePixelRatio);

// Build every item once; seek() only toggles visibility and classes.
const nodes = timeline.items.map((item) => {
  const li = document.createElement('li');
  li.hidden = true;
  if (item.kind === 'label') {
    li.className = 'label';
    li.textContent = item.text;
    return { item, li, words: [] as HTMLElement[], bars: [] as HTMLElement[] };
  }
  li.className = `message ${item.who}`;
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = item.who === 'bot' ? 'jargo' : 'You';
  const barsEl = document.createElement('span');
  barsEl.className = 'bars';
  const bars = [0, 1, 2, 3].map(() => barsEl.appendChild(document.createElement('i')));
  who.append(barsEl);
  const text = document.createElement('div');
  text.className = 'text';
  // Words are shown as they are spoken; the bubble grows like streamed text.
  const words = item.words.map((w, i) => {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = (i ? ' ' : '') + w.word;
    text.append(span);
    return span;
  });
  li.append(who, text);
  return { item, li, words, bars };
});
chat.append(...nodes.map((n) => n.li));

function seek(t: number) {
  const frame = Math.min(timeline.levels.length - 1, Math.max(0, Math.round(t * timeline.fps)));
  const level = timeline.levels[frame] ?? 0;

  let newest: (typeof nodes)[number] | null = null;
  for (const n of nodes) {
    const shown = t >= n.item.at;
    n.li.hidden = !shown;
    if (!shown) continue;
    newest = n;
    const p = ease((t - n.item.at) / ENTER);
    n.li.style.opacity = String(p);
    n.li.style.transform = `translateY(${(1 - p) * 10}px) scale(${0.98 + 0.02 * p})`;
    if (n.item.kind !== 'message') continue;
    const m = n.item;
    m.words.forEach((w, i) => n.words[i].classList.toggle('on', t >= w.start));
    const cut = m.cutAt != null && t >= m.cutAt;
    n.li.classList.toggle('cut', cut);
    const speaking = t >= m.start && t < m.end;
    n.li.classList.toggle('speaking', speaking);
    n.bars.forEach((b, i) => {
      const h = speaking ? 3 + level * 9 * (0.55 + 0.45 * Math.abs(Math.sin(t * 11 + i * 1.9))) : 3;
      b.style.height = `${h.toFixed(1)}px`;
    });
  }

  // Slide the stack up as the newest item enters.
  if (newest) {
    const p = ease((t - newest.item.at) / ENTER);
    chat.style.transform = `translateY(${((1 - p) * (newest.li.offsetHeight + 12)).toFixed(2)}px)`;
  }

  // Outro: the chat fades out, the logo and the address fade in.
  const o = ease((t - (timeline.duration - OUTRO)) / 0.8);
  viewport.style.opacity = String(1 - o);
  outro.style.opacity = String(o);
  outro.style.transform = `translateY(${(1 - o) * 8}px)`;

  waves.draw({ time: 6 + t, level });
}

(window as any).__timeline = { fps: timeline.fps, duration: timeline.duration };
(window as any).__seek = seek;
await document.fonts.ready;
seek(0);
(window as any).__ready = true;
