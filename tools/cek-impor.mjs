// Pemeriksa statis untuk proyek tanpa bundler.
//
// Tanpa build step tidak ada yang memvalidasi jalur import — satu typo baru
// ketahuan saat halaman dibuka, dan di proyek ini "saat halaman dibuka" bisa
// berarti di tangan tamu pada hari pernikahan. Skrip ini memeriksanya lebih awal:
//
//   1. setiap import relatif menunjuk berkas yang benar-benar ada;
//   2. setiap nama yang diimpor memang diekspor oleh berkas tujuan;
//   3. daftar precache di sw.js cocok dengan berkas yang ada, dan sebaliknya;
//   4. berkas yang dirujuk HTML ada DAN masuk daftar precache;
//   5. setiap view mengekspor render();
//   6. modul murni benar-benar bisa diimpor di Node (penjaga agar selftest tidak
//      pelan-pelan rusak ketika seseorang menambah document.* di sana);
//   7. tidak ada CDN dan tidak ada thumbnail Drive yang di-hotlink;
//   8. sw.js masih memuat penjaga-penjaga yang kritis.
//
// Jalankan: node tools/cek-impor.mjs
// Diadaptasi dari catat-balik/tools/cek-impor.mjs.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const galat = [];
const peringatan = [];

function berkasBer(dir, akhiran) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) out.push(...berkasBer(p, akhiran));
    else if (nama.endsWith(akhiran)) out.push(p);
  }
  return out;
}

function ekspor(isi) {
  const nama = new Set();
  for (const m of isi.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g
  )) {
    nama.add(m[1]);
  }
  for (const m of isi.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const bagian of m[1].split(',')) {
      const t = bagian.trim();
      if (!t) continue;
      const cocok = t.match(/(?:\S+)\s+as\s+([A-Za-z0-9_$]+)$/);
      nama.add(cocok ? cocok[1] : t);
    }
  }
  if (/export\s+default/.test(isi)) nama.add('default');
  return nama;
}

function impor(isi) {
  const hasil = [];
  const pola = /import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  for (const m of isi.matchAll(pola)) {
    const dari = m[2] || m[3];
    const klausa = (m[1] || '').trim();
    const nama = [];
    let bintang = false;
    if (klausa.startsWith('*')) bintang = true;
    else {
      const kurung = klausa.match(/\{([^}]*)\}/);
      if (kurung) {
        for (const bagian of kurung[1].split(',')) {
          const t = bagian.trim();
          if (!t) continue;
          const asli = t.split(/\s+as\s+/)[0].trim();
          nama.push(asli);
        }
      }
      const bawaan = klausa.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
      if (bawaan) nama.push('default');
    }
    hasil.push({ dari, nama, bintang });
  }
  return hasil;
}

/* ------------------------------------------------- 1 & 2: import dan ekspor */

const modul = berkasBer(join(AKAR, 'assets', 'js'), '.js').concat(
  berkasBer(join(AKAR, 'cetak'), '.js'),
  berkasBer(join(AKAR, 'vendor'), '.js')
);

for (const berkas of modul) {
  const isi = readFileSync(berkas, 'utf8');
  for (const { dari, nama, bintang } of impor(isi)) {
    if (!dari.startsWith('.')) {
      galat.push(`${relative(AKAR, berkas)}: import bukan relatif "${dari}" (tanpa bundler, ini tidak akan jalan)`);
      continue;
    }
    const tujuan = resolve(dirname(berkas), dari);
    if (!existsSync(tujuan)) {
      galat.push(`${relative(AKAR, berkas)}: import menunjuk berkas yang tidak ada "${dari}"`);
      continue;
    }
    if (bintang) continue;
    const tersedia = ekspor(readFileSync(tujuan, 'utf8'));
    for (const n of nama) {
      if (!tersedia.has(n)) {
        galat.push(`${relative(AKAR, berkas)}: "${n}" tidak diekspor oleh ${dari}`);
      }
    }
  }
}

/* --------------------------------------------- 3: daftar precache di sw.js */

const swIsi = readFileSync(join(AKAR, 'sw.js'), 'utf8');
const blokAset = swIsi.match(/const ASET = \[([\s\S]*?)\];/);
if (!blokAset) {
  galat.push('sw.js: daftar ASET tidak ditemukan');
}
const aset = new Set(
  (blokAset ? [...blokAset[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []).map((s) =>
    s.replace(/^\.\//, '')
  )
);

for (const entri of aset) {
  if (entri === '') continue; // './' = halaman utama
  if (!existsSync(join(AKAR, entri))) {
    galat.push(`sw.js: ASET memuat "${entri}" yang tidak ada di disk`);
  }
}

for (const berkas of modul) {
  const rel = relative(AKAR, berkas).replace(/\\/g, '/');
  if (!aset.has(rel)) {
    galat.push(`sw.js: ${rel} tidak ada di daftar ASET (tidak akan tersedia offline)`);
  }
}

for (const css of berkasBer(join(AKAR, 'assets', 'css'), '.css')) {
  const rel = relative(AKAR, css).replace(/\\/g, '/');
  if (!aset.has(rel)) galat.push(`sw.js: ${rel} tidak ada di daftar ASET`);
}

/* ----------------------------------------- 4: rujukan di berkas HTML */

const htmlBerkas = berkasBer(AKAR, '.html').filter(
  (p) => !relative(AKAR, p).startsWith('node_modules') && !/__smoke/.test(p)
);

for (const berkas of htmlBerkas) {
  const isi = readFileSync(berkas, 'utf8');
  const rujukan = [
    ...[...isi.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...isi.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ...[...isi.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1])
  ];
  for (const r of rujukan) {
    if (/^https?:|^data:|^#/.test(r)) continue;
    const tujuan = resolve(dirname(berkas), r);
    if (!existsSync(tujuan)) {
      galat.push(`${relative(AKAR, berkas)}: merujuk "${r}" yang tidak ada`);
      continue;
    }
    const rel = relative(AKAR, tujuan).replace(/\\/g, '/');
    if (!aset.has(rel)) {
      galat.push(`sw.js: "${rel}" dirujuk ${relative(AKAR, berkas)} tapi tidak ada di ASET`);
    }
  }
}

/* ----------------------------------------------- 5: kontrak view dan rute */

const views = berkasBer(join(AKAR, 'assets', 'js', 'views'), '.js');
for (const v of views) {
  const e = ekspor(readFileSync(v, 'utf8'));
  if (!e.has('render')) galat.push(`${relative(AKAR, v)}: view wajib mengekspor render()`);
  if (!e.has('judulHalaman')) peringatan.push(`${relative(AKAR, v)}: tidak mengekspor judulHalaman`);
}

const appIsi = readFileSync(join(AKAR, 'assets', 'js', 'app.js'), 'utf8');
for (const v of views) {
  const nama = relative(join(AKAR, 'assets', 'js'), v).replace(/\\/g, '/');
  if (!appIsi.includes(nama)) {
    peringatan.push(`app.js tidak mengimpor ${nama} — view yatim?`);
  }
}

/* ------------------------------------------------------ 6: kemurnian modul */

const MURNI = ['assets/js/fmt.js', 'assets/js/exif.js', 'cetak/qr-inti.js'];
for (const m of MURNI) {
  try {
    await import('file:///' + join(AKAR, m).replace(/\\/g, '/'));
  } catch (e) {
    galat.push(`${m}: gagal diimpor di Node (${e.message}) — selftest akan rusak`);
  }
}

/* ------------------------------- 7: tanpa CDN, tanpa thumbnail Drive */

const semuaSumber = modul
  .concat(htmlBerkas)
  .concat(berkasBer(join(AKAR, 'assets', 'css'), '.css'))
  .concat([join(AKAR, 'sw.js')]);

/**
 * Buang komentar sebelum memindai larangan.
 *
 * Tanpa ini, komentar yang MENJELASKAN mengapa thumbnail Drive dilarang justru
 * ikut tertangkap sebagai pelanggaran — dan cara termudah menenangkan pemeriksa
 * jadi menghapus penjelasannya. Pemeriksa tidak boleh menghukum dokumentasi.
 */
function tanpaKomentar(isi) {
  return isi
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

for (const berkas of semuaSumber) {
  const isi = tanpaKomentar(readFileSync(berkas, 'utf8'));
  const rel = relative(AKAR, berkas).replace(/\\/g, '/');

  for (const m of isi.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)) {
    galat.push(`${rel}: memuat skrip dari CDN "${m[1]}" — harus di-pin di vendor/`);
  }
  for (const m of isi.matchAll(/<link[^>]+href="(https?:[^"]+)"/g)) {
    galat.push(`${rel}: memuat stylesheet/font dari luar "${m[1]}" — venue bisa tanpa internet`);
  }
  for (const m of isi.matchAll(/from\s*['"](https?:[^'"]+)['"]/g)) {
    galat.push(`${rel}: import dari URL "${m[1]}"`);
  }

  // Galeri acara TIDAK boleh pernah kembali ke thumbnail Drive yang di-hotlink:
  // endpoint itu kena rate-limit pada halaman dengan 10+ gambar.
  if (/drive\.google\.com\/thumbnail|lh3\.googleusercontent\.com/.test(isi)) {
    galat.push(`${rel}: memakai thumbnail Drive yang di-hotlink (kena rate-limit, dilarang)`);
  }
}

/* ------------------------------------------------- 8: penjaga kritis di sw.js */

if (!/const VERSI = /.test(swIsi)) galat.push('sw.js: konstanta VERSI tidak ada');
if (!/req\.method !== 'GET'/.test(swIsi)) {
  galat.push('sw.js: penjaga non-GET hilang — POST unggahan bisa tersentuh cache');
}
// Dicari sebagai teks biasa, bukan regex: di sw.js nama host ditulis DI DALAM
// regex literal, jadi sumbernya memuat backslash (script\.google\.com).
// Membandingkannya sebagai pola akan selalu luput.
const swDatar = swIsi.replace(/\\/g, '');
for (const host of ['script.google.com', 'script.googleusercontent.com']) {
  if (!swDatar.includes(host)) {
    galat.push(`sw.js: penjaga host ${host} hilang — balasan backend bisa ter-cache`);
  }
}

/* ------------------------------------------- 9: atribut hidden harus menang */

// Aturan bawaan browser `[hidden] { display: none }` kalah spesifisitas dari
// selector kelas. Tanpa penguat global, satu `display: flex` di stylesheet
// membuat elemen yang "disembunyikan" lewat JS tetap tergambar — dan itulah
// yang pernah membuat viewfinder tampak hitam padahal kameranya hidup.
const cssUtama = readFileSync(join(AKAR, 'assets', 'css', 'app.css'), 'utf8');
if (!/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(cssUtama)) {
  galat.push(
    'app.css: aturan global [hidden] { display: none !important } hilang — ' +
      'elemen yang disembunyikan lewat JS bisa tetap tergambar'
  );
}

/* -------------------------------------------------------- data/api.json waras */

const api = JSON.parse(readFileSync(join(AKAR, 'data', 'api.json'), 'utf8'));
if (api.dasar !== null && !/^https?:\/\//.test(String(api.dasar))) {
  galat.push('data/api.json: "dasar" harus null atau URL http(s)');
}
if (api.dasar && /script\.google\.com/.test(api.dasar) && !/\/exec$/.test(api.dasar)) {
  galat.push('data/api.json: URL Apps Script harus berakhiran /exec, bukan /dev');
}

/* -------------------------------------------------------------------- hasil */

for (const p of peringatan) console.warn('  catatan: ' + p);
console.log(`\nCek impor: ${modul.length} modul, ${aset.size} aset precache, ${galat.length} galat`);
if (galat.length) {
  for (const g of galat) console.error('  GALAT ' + g);
  process.exit(1);
}
