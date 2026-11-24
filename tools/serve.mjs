// Server statis mungil untuk mencoba aplikasi secara lokal tanpa XAMPP,
// LENGKAP dengan tiruan endpoint backend.
//
// Jalankan: node tools/serve.mjs [port]   lalu buka http://localhost:8765/
//
// ES module tidak bisa dimuat lewat file://, jadi aplikasi memang harus
// disajikan lewat http — entah dengan skrip ini, XAMPP, atau GitHub Pages.
//
// Tiruan /__unggah memungkinkan seluruh janji produk diuji tanpa menyentuh
// Google: antrean, backoff, idempotensi, dan status di "Foto Saya". Isi
// data/api.json dengan {"dasar": "http://localhost:8765/__unggah"} untuk
// memakainya. Batas kejujurannya: tiruan ini same-origin, jadi ia TIDAK menguji
// perilaku CORS/redirect Apps Script yang sebenarnya — itu hanya bisa
// dibuktikan dengan tools/cek-endpoint.mjs ke deployment nyata.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Nama berkas dirakit dengan fungsi yang SAMA dengan yang dipakai aplikasi tamu.
// Dengan begitu tiruan ini ikut membuktikan bahwa konvensi nama di klien dan di
// server benar-benar sama — bukan hanya mirip.
import { namaBerkas } from '../assets/js/fmt.js';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8765;

/**
 * `--stub` membuat /data/api.json dijawab dengan alamat tiruan di server ini,
 * TANPA menyentuh berkas di repo.
 *
 * Itu penting: uji asap harus menjalankan jalur kode yang sama dengan tamu
 * (membaca data/api.json, bukan konfigurasi yang disuntik), sementara berkas
 * yang di-commit tetap `"dasar": null` supaya tidak ada alamat uji yang ikut
 * ter-deploy ke GitHub Pages.
 */
const STUB = process.argv.includes('--stub');

const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/** Pembukuan tiruan, hanya di memori: hilang saat server dimatikan. */
const sudahMasuk = new Map(); // kunci -> { idBerkas, namaBerkas }
let nomor = 0;

/** Token tiruan. Sengaja ada supaya uji "token salah ditolak" bisa dibuktikan. */
const TOKEN_TIRUAN = 'uji';

function jsonkan(res, obj, status = 200) {
  const badan = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store'
  });
  res.end(badan);
}

function bacaBadan(req, batas = 16 * 1024 * 1024) {
  return new Promise((selesai, gagal) => {
    let n = 0;
    const bagian = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > batas) {
        gagal(new Error('badan terlalu besar'));
        req.destroy();
        return;
      }
      bagian.push(c);
    });
    req.on('end', () => selesai(Buffer.concat(bagian).toString('utf8')));
    req.on('error', gagal);
  });
}

async function tanganiUnggah(req, res, url) {
  const p = url.searchParams;
  const tunda = Number(p.get('lambat') || 0);
  if (tunda > 0) await new Promise((r) => setTimeout(r, tunda));

  if (p.get('gagal') === '1') {
    return jsonkan(res, { ok: false, kode: 'GALAT_DALAM', pesan: 'gagal yang disengaja', ulangi: true, tunggu_ms: 1000 });
  }

  const kunci = p.get('kunci');
  if (!kunci) {
    return jsonkan(res, { ok: false, kode: 'PARAM_KURANG', pesan: 'kunci tidak ada', ulangi: false });
  }

  if (p.get('t') !== TOKEN_TIRUAN) {
    return jsonkan(res, { ok: false, kode: 'TOKEN_SALAH', pesan: 'token tidak dikenali', ulangi: false });
  }

  // Idempotensi: kunci yang sama tidak pernah membuat berkas kedua. Inilah
  // perilaku yang ditiru paling penting — tanpa ini, uji "retry setelah
  // timeout" tidak membuktikan apa pun.
  if (sudahMasuk.has(kunci)) {
    const lama = sudahMasuk.get(kunci);
    return jsonkan(res, { ok: true, kode: 'DUPLIKAT', duplikat: true, ...lama, kunci, terindeks: true });
  }

  let badan = '';
  try {
    badan = await bacaBadan(req);
  } catch {
    return jsonkan(res, { ok: false, kode: 'TERLALU_BESAR', pesan: 'badan terlalu besar', ulangi: true });
  }

  const bersih = badan.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const bytes = Buffer.from(bersih, 'base64');
  if (bytes.length < 100) {
    return jsonkan(res, { ok: false, kode: 'TERLALU_KECIL', pesan: 'bukan foto', ulangi: false });
  }
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    return jsonkan(res, { ok: false, kode: 'BUKAN_JPEG', pesan: 'bukan JPEG', ulangi: false });
  }

  const idBerkas = 'stub-' + String(++nomor).padStart(4, '0');
  const nama = namaBerkas({ waktu: Date.now(), nama: p.get('nama') || 'Tamu', kunci });
  sudahMasuk.set(kunci, { idBerkas, namaBerkas: nama, url: 'about:blank#' + idBerkas });

  console.log(
    `  unggah ok  ${bytes.length} byte  nama=${p.get('nama') || '-'}  kunci=${kunci.slice(0, 8)}`
  );
  return jsonkan(res, {
    ok: true,
    kode: 'TERSIMPAN',
    duplikat: false,
    idBerkas,
    namaBerkas: nama,
    url: 'about:blank#' + idBerkas,
    kunci,
    terindeks: true,
    ukuran: bytes.length,
    versi: 'stub'
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__unggah') {
    if (req.method === 'POST') return tanganiUnggah(req, res, url);
    const aksi = url.searchParams.get('aksi');
    if (aksi === 'sehat') {
      return jsonkan(res, {
        ok: true,
        versi: 'stub',
        aktif: true,
        zona: 'Asia/Jakarta',
        waktu_server: new Date().toISOString(),
        jendela: { mulai: '-', selesai: '-', di_dalam: true },
        terpakai_hari_ini: sudahMasuk.size,
        sisa_kuota: 9999
      });
    }
    if (aksi === 'terbaru') {
      return jsonkan(res, {
        ok: true,
        foto: [...sudahMasuk.values()].slice(-24).reverse()
      });
    }
    return jsonkan(res, { ok: false, kode: 'AKSI_TIDAK_DIKENAL', pesan: String(aksi), ulangi: false });
  }

  if (STUB && url.pathname === '/data/api.json') {
    return jsonkan(res, {
      catatan: 'konfigurasi tiruan dari tools/serve.mjs --stub; berkas di repo tidak diubah',
      dasar: `http://localhost:${PORT}/__unggah`,
      token: 'uji'
    });
  }

  if (url.pathname === '/__reset') {
    sudahMasuk.clear();
    nomor = 0;
    return jsonkan(res, { ok: true, kode: 'DIRESET' });
  }

  let jalur = decodeURIComponent(url.pathname);
  if (jalur.endsWith('/')) jalur += 'index.html';
  const berkas = join(AKAR, normalize(jalur).replace(/^(\.\.[/\\])+/, ''));

  try {
    const s = await stat(berkas);
    if (s.isDirectory()) throw new Error('direktori');
    const isi = await readFile(berkas);
    res.writeHead(200, {
      'content-type': TIPE[extname(berkas).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      // Supaya service worker boleh mengambil cakupan seluruh situs saat diuji
      // dari subdirektori.
      'service-worker-allowed': '/'
    });
    res.end(isi);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 ' + jalur);
  }
});

server.listen(PORT, () => {
  console.log(`Foto Nikah di http://localhost:${PORT}/`);
  console.log(`Tiruan backend di http://localhost:${PORT}/__unggah`);
});
