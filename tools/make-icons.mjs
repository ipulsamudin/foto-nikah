// Membuat ikon PNG untuk PWA tanpa dependensi apa pun.
// Jalankan dari akar proyek:  node tools/make-icons.mjs
//
// Bentuknya digambar langsung ke buffer piksel lalu dikemas sebagai PNG memakai
// zlib bawaan Node, jadi tidak perlu Canvas/sharp/puppeteer. Geometrinya
// mengikuti assets/icons/icon.svg — kalau salah satu diubah, ubah keduanya.
// Diadaptasi dari catat-balik/tools/make-icons.mjs.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROSE = [201, 123, 132]; // --rose-deep
const ROSE_GELAP = [167, 90, 102]; // --rose-dark
const CREAM = [250, 243, 240]; // --cream
const PUTIH = [255, 255, 255];
const EMAS = [201, 166, 107]; // --gold

function kanvas(n) {
  return { n, px: new Uint8Array(n * n * 4) };
}

function set(c, x, y, warna, alpha = 1) {
  if (x < 0 || y < 0 || x >= c.n || y >= c.n) return;
  const i = (y * c.n + x) * 4;
  const a0 = c.px[i + 3] / 255;
  const a1 = alpha;
  const aOut = a1 + a0 * (1 - a1);
  for (let k = 0; k < 3; k++) {
    const lama = c.px[i + k];
    c.px[i + k] = aOut ? Math.round((warna[k] * a1 + lama * a0 * (1 - a1)) / aOut) : 0;
  }
  c.px[i + 3] = Math.round(aOut * 255);
}

/** Cakupan piksel dihitung dari 3x3 sub-sampel supaya tepinya tidak bergerigi. */
function isi(c, warna, di) {
  const s = 3;
  for (let y = 0; y < c.n; y++) {
    for (let x = 0; x < c.n; x++) {
      let kena = 0;
      for (let sy = 0; sy < s; sy++) {
        for (let sx = 0; sx < s; sx++) {
          if (di(x + (sx + 0.5) / s, y + (sy + 0.5) / s)) kena++;
        }
      }
      if (kena) set(c, x, y, warna, kena / (s * s));
    }
  }
}

const kotakBulat = (x0, y0, w, h, r) => (x, y) => {
  const x1 = x0 + w;
  const y1 = y0 + h;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9;
};

const lingkaran = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Hati sederhana: dua lingkaran atas + segitiga bawah. */
const hati = (cx, cy, r) => (x, y) => {
  if (lingkaran(cx - r * 0.5, cy - r * 0.28, r * 0.56)(x, y)) return true;
  if (lingkaran(cx + r * 0.5, cy - r * 0.28, r * 0.56)(x, y)) return true;
  const t = (y - (cy - r * 0.34)) / (r * 1.3);
  if (t < 0 || t > 1) return false;
  return Math.abs(x - cx) <= r * (1 - t);
};

function gambar(n, { maskable = false } = {}) {
  const c = kanvas(n);
  const padding = maskable ? (44 / 512) * n : 0; // zona aman ikon maskable
  const sisi = n - padding * 2;
  const sk = (v) => padding + (v / 512) * sisi;
  const sv = (v) => (v / 512) * sisi;

  isi(c, ROSE, kotakBulat(0, 0, n, n, maskable ? 0 : (96 / 512) * n));

  // Badan kamera
  isi(c, CREAM, kotakBulat(sk(88), sk(170), sv(336), sv(230), sv(44)));
  // Tonjolan jendela bidik
  isi(c, CREAM, kotakBulat(sk(190), sk(132), sv(132), sv(48), sv(20)));
  // Lensa
  isi(c, ROSE_GELAP, lingkaran(sk(256), sk(286), sv(88)));
  isi(c, PUTIH, lingkaran(sk(256), sk(286), sv(62)));
  // Hati di dalam lensa — ini undangan pernikahan, bukan aplikasi kamera biasa
  isi(c, ROSE, hati(sk(256), sk(282), sv(38)));
  // Lampu kilat
  isi(c, EMAS, lingkaran(sk(362), sk(214), sv(18)));

  return c;
}

// ---------- PNG ----------

const TABEL_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let x = i;
    for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
    t[i] = x >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let x = 0xffffffff;
  for (const b of buf) x = TABEL_CRC[(x ^ b) & 0xff] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}

function potongan(tipe, data) {
  const panjang = Buffer.alloc(4);
  panjang.writeUInt32BE(data.length);
  const isiPotongan = Buffer.concat([Buffer.from(tipe, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(isiPotongan));
  return Buffer.concat([panjang, isiPotongan, crc]);
}

function png(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.n, 0);
  ihdr.writeUInt32BE(c.n, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const baris = Buffer.alloc((c.n * 4 + 1) * c.n);
  for (let y = 0; y < c.n; y++) {
    const awal = y * (c.n * 4 + 1);
    baris[awal] = 0; // filter none
    Buffer.from(c.px.buffer, y * c.n * 4, c.n * 4).copy(baris, awal + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    potongan('IHDR', ihdr),
    potongan('IDAT', deflateSync(baris, { level: 9 })),
    potongan('IEND', Buffer.alloc(0))
  ]);
}

const dir = join(AKAR, 'assets', 'icons');
mkdirSync(dir, { recursive: true });

for (const [nama, n, opsi] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { maskable: true }]
]) {
  const berkas = join(dir, nama);
  writeFileSync(berkas, png(gambar(n, opsi)));
  console.log('tulis ' + nama);
}
