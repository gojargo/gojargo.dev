// Synthesizes the demo conversation with Cartesia Sonic and lays it out on a
// timeline: video/out/mix.wav (the soundtrack) and video/out/timeline.json
// (who says which word when, the labels, and the audio level per frame).
//
//   node video/synth.mjs           synthesize (cached) + build the timeline
//   node video/synth.mjs --voices  list English voices
//   node video/synth.mjs --dry     no API call: placeholder tones, estimated timings
//
// The API key comes from $CARTESIA_API_KEY or video/.env (CARTESIA_API_KEY=...);
// it is only needed when a line is not in the cache yet.
// Each line is cached in video/.cache by (text, voice, model), so re-running
// only pays for lines that changed.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversation, labels, voices } from './conversation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, '.cache');
const OUT = join(here, 'out');

const API = 'https://api.cartesia.ai';
const VERSION = '2026-08-14';
const MODEL = 'sonic-3.6';
const RATE = 44100;
export const FPS = 30;

// Timing, in seconds.
const LEAD_IN = 1.2; // before the first word
const TURN_GAP = 0.7; // bot end → user start
const BOT_LATENCY = 0.6; // user end → bot start (end-of-turn + first audio)
const EOT_LABEL = 0.25; // user end → "end of turn" label
const CUT_DELAY = 0.25; // user starts over the bot → bot audio stops
const CUT_FADE = 0.04;
const TAIL = 2.6; // after the last word (outro)

function apiKey() {
  if (process.env.CARTESIA_API_KEY) return process.env.CARTESIA_API_KEY;
  const env = join(here, '.env');
  if (existsSync(env)) {
    const m = readFileSync(env, 'utf8').match(/^\s*CARTESIA_API_KEY\s*=\s*"?([^"\s]+)"?/m);
    if (m) return m[1];
  }
  console.error('synth: set CARTESIA_API_KEY or put CARTESIA_API_KEY=... in video/.env');
  process.exit(1);
}

const headers = (key) => ({
  Authorization: `Bearer ${key}`,
  'Cartesia-Version': VERSION,
  'Content-Type': 'application/json',
});

async function listVoices(key) {
  const res = await fetch(`${API}/voices?language=en&limit=100`, { headers: headers(key) });
  if (!res.ok) throw new Error(`voices: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.data ?? []);
  for (const v of list) {
    console.log(`${v.id}  ${(v.gender ?? '').padEnd(10)} ${v.name}${v.description ? ` · ${v.description}` : ''}`);
  }
}

/** One line → { pcm: Int16Array, words: [{ word, start, end }] }, cached. */
async function synth(getKey, text, voice) {
  const id = createHash('sha256').update(JSON.stringify({ text, voice, MODEL, RATE })).digest('hex').slice(0, 16);
  const pcmPath = join(CACHE, `${id}.pcm`);
  const metaPath = join(CACHE, `${id}.json`);
  if (existsSync(pcmPath) && existsSync(metaPath)) {
    const buf = readFileSync(pcmPath);
    return { pcm: new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), ...JSON.parse(readFileSync(metaPath, 'utf8')) };
  }

  console.log(`synth: Cartesia ← "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"`);
  const res = await fetch(`${API}/tts/sse`, {
    method: 'POST',
    headers: headers(getKey()),
    body: JSON.stringify({
      model_id: MODEL,
      transcript: text,
      voice: { mode: 'id', id: voice },
      language: 'en',
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE },
      add_timestamps: true,
    }),
  });
  if (!res.ok) throw new Error(`tts: ${res.status} ${await res.text()}`);

  const chunks = [];
  const words = [];
  let buffered = '';
  const handle = (event) => {
    const data = event
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    const msg = JSON.parse(data);
    if (msg.type === 'chunk' && msg.data) chunks.push(Buffer.from(msg.data, 'base64'));
    else if (msg.type === 'timestamps' && msg.word_timestamps) {
      const w = msg.word_timestamps;
      w.words.forEach((word, i) => words.push({ word, start: w.start[i], end: w.end?.[i] ?? w.start[i] }));
    } else if (msg.type === 'error') throw new Error(`tts: ${msg.title}: ${msg.message}`);
  };
  const decoder = new TextDecoder();
  for await (const part of res.body) {
    buffered += decoder.decode(part, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buffered.indexOf('\n\n')) >= 0) {
      handle(buffered.slice(0, i));
      buffered = buffered.slice(i + 2);
    }
  }
  if (buffered.trim()) handle(buffered);

  const buf = Buffer.concat(chunks);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(pcmPath, buf);
  writeFileSync(metaPath, JSON.stringify({ words }));
  return { pcm: new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), words };
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** --dry: a quiet tone per word and estimated timings, to work on the visuals for free. */
function fakeSynth(text) {
  const words = [];
  let t = 0.05;
  for (const word of text.split(/\s+/)) {
    const d = 0.12 + word.length * 0.045;
    words.push({ word, start: t, end: t + d });
    t += d + 0.06;
  }
  const pcm = new Int16Array(Math.ceil((t + 0.1) * RATE));
  for (const w of words) {
    for (let i = Math.floor(w.start * RATE); i < w.end * RATE; i++) {
      const x = (i / RATE - w.start) / (w.end - w.start);
      pcm[i] = Math.round(Math.sin(Math.PI * x) * Math.sin(i * 0.05) * 6000);
    }
  }
  return { pcm, words };
}

async function main() {
  const dry = process.argv.includes('--dry');
  if (process.argv.includes('--voices')) return listVoices(apiKey());
  if (!dry && (!voices.user || !voices.bot)) {
    console.error('synth: set the voice IDs in video/conversation.mjs (npm run video:voices lists them)');
    process.exit(1);
  }

  const lines = [];
  for (const line of conversation) {
    lines.push({ ...line, ...(dry ? fakeSynth(line.text) : await synth(apiKey, line.text, voices[line.who])) });
  }

  // Lay the lines out.
  const items = [{ kind: 'label', text: labels.connected, at: 0.35 }];
  let t = LEAD_IN;
  let prev = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const duration = line.pcm.length / RATE;
    let start;
    if (line.who === 'user') {
      if (prev?.interruptAt != null) {
        // Speak over the previous bot line, which jargo then cuts.
        start = prev.interruptAt;
        prev.cutAt = start + CUT_DELAY;
        prev.end = Math.min(prev.end, prev.cutAt);
        items.push({ kind: 'label', text: labels.interruption, at: start + 0.2 });
      } else {
        start = prev ? prev.end + TURN_GAP : t;
      }
    } else {
      start = prev.end + BOT_LATENCY;
      items.push({ kind: 'label', text: labels.endOfTurn, at: prev.end + EOT_LABEL });
    }

    const item = {
      kind: 'message',
      who: line.who,
      at: start,
      start,
      end: start + duration,
      words: line.words.map((w) => ({ word: w.word, start: start + w.start, end: start + w.end })),
      pcm: line.pcm,
    };
    if (line.interruptAt) {
      const k = line.words.findIndex((w) => w.word.replace(/\W/g, '').toLowerCase() === line.interruptAt.toLowerCase());
      if (k < 0) throw new Error(`interruptAt "${line.interruptAt}" not found in: ${line.text}`);
      item.interruptAt = start + line.words[k].start;
    }
    items.push(item);
    prev = item;
  }
  for (const it of items) if (it.kind === 'message' && it.cutAt != null) it.words = it.words.filter((w) => w.start < it.cutAt);

  const duration = Math.max(...items.map((it) => it.end ?? it.at)) + TAIL;

  // Mix.
  const mix = new Float32Array(Math.ceil(duration * RATE));
  for (const it of items) {
    if (it.kind !== 'message') continue;
    const offset = Math.round(it.start * RATE);
    const stop = it.cutAt != null ? Math.round((it.cutAt - it.start) * RATE) : it.pcm.length;
    const fade = Math.round(CUT_FADE * RATE);
    for (let i = 0; i < Math.min(stop, it.pcm.length); i++) {
      let g = 1;
      if (it.cutAt != null && i > stop - fade) g = (stop - i) / fade;
      mix[offset + i] += (it.pcm[i] / 32768) * g;
    }
  }
  let peak = 0;
  for (const s of mix) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.89 / peak : 1; // -1 dBFS
  for (let i = 0; i < mix.length; i++) mix[i] *= gain;

  // Level per video frame: RMS, normalised, with a fast attack and slow release.
  const per = RATE / FPS;
  const frames = Math.ceil(duration * FPS);
  const rms = Array.from({ length: frames }, (_, f) => {
    let sum = 0;
    const a = Math.floor(f * per);
    const b = Math.min(mix.length, Math.floor((f + 1) * per));
    for (let i = a; i < b; i++) sum += mix[i] * mix[i];
    return Math.sqrt(sum / Math.max(1, b - a));
  });
  const ref = [...rms].sort((x, y) => x - y)[Math.floor(frames * 0.95)] || 1;
  let lv = 0;
  const levels = rms.map((r) => {
    const target = Math.min(1, r / ref);
    lv += (target - lv) * (target > lv ? 0.6 : 0.15);
    return Math.round(lv * 1000) / 1000;
  });

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'mix.wav'), wav(mix));
  const timeline = {
    fps: FPS,
    duration,
    items: items.map(({ pcm, ...rest }) => rest),
    levels,
  };
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
  console.log(`synth: ${lines.length} lines, ${duration.toFixed(1)} s → video/out/mix.wav, timeline.json`);
}

await main();
