/**
 * Generates PingBack's bundled notification sounds as 16-bit PCM WAV files.
 *
 * The sounds are synthesized rather than shipped as third-party audio so the
 * package carries no external audio licensing obligations.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;

/** Raised-cosine attack/release so tones start and stop without clicks. */
function envelope(position, total) {
  const fade = Math.min(Math.floor(total * 0.25), Math.floor(SAMPLE_RATE * 0.02));
  if (fade <= 0) return 1;
  if (position < fade) return 0.5 - 0.5 * Math.cos((Math.PI * position) / fade);
  if (position > total - fade) {
    return 0.5 - 0.5 * Math.cos((Math.PI * (total - position)) / fade);
  }
  return 1;
}

function tone({ frequency, durationMs, amplitude }) {
  const total = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const samples = new Float64Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    // Fundamental plus a quiet second harmonic for a softer, bell-like timbre.
    const wave =
      Math.sin(2 * Math.PI * frequency * t) +
      0.18 * Math.sin(4 * Math.PI * frequency * t);
    samples[i] = wave * amplitude * envelope(i, total) * Math.exp(-2.2 * t);
  }
  return samples;
}

function silence(durationMs) {
  return new Float64Array(Math.floor((durationMs / 1000) * SAMPLE_RATE));
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float64Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toWav(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

const sounds = {
  // High priority: a clear rising two-note chime.
  attention: concat([
    tone({ frequency: 880.0, durationMs: 130, amplitude: 0.24 }),
    silence(25),
    tone({ frequency: 1174.66, durationMs: 190, amplitude: 0.24 }),
  ]),
  // Low priority: quieter and shorter so completions stay unobtrusive.
  completion: concat([
    tone({ frequency: 1046.5, durationMs: 100, amplitude: 0.15 }),
    silence(20),
    tone({ frequency: 1318.51, durationMs: 150, amplitude: 0.13 }),
  ]),
  // Medium priority: two low blips, distinct from the attention chime.
  error: concat([
    tone({ frequency: 392.0, durationMs: 110, amplitude: 0.2 }),
    silence(45),
    tone({ frequency: 329.63, durationMs: 170, amplitude: 0.2 }),
  ]),
};

const outDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'sounds',
);
mkdirSync(outDir, { recursive: true });

for (const [name, samples] of Object.entries(sounds)) {
  const file = path.join(outDir, `${name}.wav`);
  writeFileSync(file, toWav(samples));
  console.log(`generated ${path.relative(process.cwd(), file)}`);
}
