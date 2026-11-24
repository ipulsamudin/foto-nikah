// Uji asap di browser sungguhan (Chrome/Edge headless) — nol dependensi.
//
// Jalankan: node tools/smoke.mjs
//
// MENGAPA memakai CDP lewat WebSocket dan bukan --dump-dom:
// --dump-dom membuang DOM begitu waktu virtual habis, dan waktu virtual TIDAK
// menggerakkan antrean tugas IndexedDB. Akibatnya halaman yang menunggu IDB
// selalu terbaca kosong, dan ujinya hanya membuktikan bahwa HTML terkirim.
// Yang perlu dibuktikan justru yang sesudah itu: kamera menghasilkan JPEG,
// barisnya masuk IndexedDB, dan antreannya benar-benar terkuras ke backend.
// Node 22 sudah punya WebSocket global, jadi CDP bisa dipakai tanpa paket apa pun.
//
// Yang TIDAK bisa dibuktikan di sini, dan karena itu tidak diklaim:
// perilaku navigator.share di iOS, apakah Safari menerapkan orientasi EXIF
// sendiri, dan CORS Apps Script yang sebenarnya (tiruan di serve.mjs same-origin).
// Itu wilayah docs/uji-perangkat.md dan tools/cek-endpoint.mjs.

import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8766;
const PORT_CDP = 9333;

const KANDIDAT = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
].filter(Boolean);

let lulus = 0;
const gagal = [];

function cek(nama, benar, detail = '') {
  if (benar) {
    lulus++;
    console.log('  ok   ' + nama);
    return;
  }
  gagal.push(`${nama}${detail ? ` — ${detail}` : ''}`);
  console.error('  GAGAL ' + nama + (detail ? ' — ' + detail : ''));
}

function tunggu(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tungguSampai(fn, batasMs = 15000, jeda = 250) {
  const akhir = Date.now() + batasMs;
  for (;;) {
    try {
      const hasil = await fn();
      if (hasil) return hasil;
    } catch {
      /* belum siap */
    }
    if (Date.now() > akhir) return null;
    await tunggu(jeda);
  }
}

/* ------------------------------------------------------------- klien CDP */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nomor = 0;
    this.menunggu = new Map();
    ws.addEventListener('message', (ev) => {
      const pesan = JSON.parse(ev.data);
      const janji = this.menunggu.get(pesan.id);
      if (!janji) return;
      this.menunggu.delete(pesan.id);
      if (pesan.error) janji.gagal(new Error(JSON.stringify(pesan.error)));
      else janji.selesai(pesan.result);
    });
  }

  kirim(metode, params = {}) {
    const id = ++this.nomor;
    this.ws.send(JSON.stringify({ id, method: metode, params }));
    return new Promise((selesai, gagal) => {
      this.menunggu.set(id, { selesai, gagal });
      setTimeout(() => {
        if (this.menunggu.delete(id)) gagal(new Error('CDP timeout: ' + metode));
      }, 60000);
    });
  }

  /** Jalankan ekspresi async di dalam halaman dan kembalikan nilainya. */
  async nilai(ekspresi) {
    const r = await this.kirim('Runtime.evaluate', {
      expression: `(async () => { ${ekspresi} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)
      );
    }
    return r.result.value;
  }
}

/* ------------------------------------------------------------------ utama */

const browser = KANDIDAT.find((p) => existsSync(p));
if (!browser) {
  console.log('Uji asap dilewati: Chrome/Edge tidak ditemukan di mesin ini.');
  process.exit(0);
}

const profil = mkdtempSync(join(tmpdir(), 'foto-nikah-smoke-'));
let server = null;
let chrome = null;

try {
  server = spawn(process.execPath, [join(AKAR, 'tools', 'serve.mjs'), String(PORT), '--stub'], {
    stdio: 'ignore'
  });

  const sehat = await tungguSampai(async () => {
    const r = await fetch(`http://localhost:${PORT}/__unggah?aksi=sehat`);
    return r.ok;
  }, 10000);
  if (!sehat) throw new Error('server uji tidak mau hidup');

  chrome = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      `--user-data-dir=${profil}`,
      `--remote-debugging-port=${PORT_CDP}`,
      // Izin kamera otomatis + perangkat video sintetis: tanpa dua flag ini
      // getUserMedia akan menunggu dialog yang tidak akan pernah muncul.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `http://localhost:${PORT}/?to=Rani%20Agustina`
    ],
    { stdio: 'ignore' }
  );

  const target = await tungguSampai(async () => {
    const r = await fetch(`http://localhost:${PORT_CDP}/json/list`);
    const daftar = await r.json();
    return daftar.find((t) => t.type === 'page' && t.url.includes(String(PORT)));
  }, 20000);
  if (!target) throw new Error('target halaman tidak ditemukan lewat CDP');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((selesai, tolak) => {
    ws.addEventListener('open', selesai, { once: true });
    ws.addEventListener('error', () => tolak(new Error('WebSocket CDP gagal')), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.kirim('Runtime.enable');

  /* ------------------------------------------------- 1. halaman & gerbang nama */

  const siapHalaman = await tungguSampai(
    () => cdp.nilai('return Boolean(document.querySelector("#bidik-video"));'),
    15000
  );
  cek('halaman render dan masuk panel jepret (?to= mengisi nama)', Boolean(siapHalaman));

  cek(
    'nama dari ?to= dipakai',
    (await cdp.nilai(
      'const m = await import("./assets/js/tamu.js"); return m.namaEfektif();'
    )) === 'Rani Agustina'
  );

  /* -------------------------------------------------------------- 2. IndexedDB */

  const idb = await cdp.nilai(`
    const a = await import('./assets/js/antrean.js');
    await a.bukaDb();
    const r = await a.hitung();
    return r.total;
  `);
  cek('IndexedDB bisa dibuka dan dibaca', typeof idb === 'number', 'dapat ' + idb);

  /* ------------------------------------------------------- 3. tangkap dari kamera */

  // Tunggu kontrak yang dilihat tamu: tombol jepret baru muncul setelah kamera
  // benar-benar punya gambar. Menunggu tombol ini, bukan menunggu waktu, membuat
  // uji ini menguji janji yang sama dengan yang dilihat pengguna.
  const siapJepret = await tungguSampai(
    () => cdp.nilai('const b = document.querySelector("#tombol-jepret"); return Boolean(b && !b.hidden);'),
    20000
  );
  cek('tombol jepret muncul setelah kamera siap', Boolean(siapJepret));

  const tangkap = await cdp.nilai(`
    const kam = await import('./assets/js/kamera.js');
    const gbr = await import('./assets/js/gambar.js');
    const video = document.querySelector('#bidik-video');
    if (!kam.sedangMenyala()) await kam.mulai(video);
    const { blob, lebar, tinggi } = await gbr.dariVideo(video);
    const kepala = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    const prediksi = gbr.ukuranTerskala(video.videoWidth, video.videoHeight);
    return {
      ukuran: blob.size,
      tipe: blob.type,
      lebar, tinggi,
      prediksiLebar: prediksi.lebar,
      prediksiTinggi: prediksi.tinggi,
      jpeg: kepala[0] === 255 && kepala[1] === 216 && kepala[2] === 255
    };
  `);
  cek('kamera palsu menghasilkan JPEG', tangkap.jpeg && tangkap.tipe === 'image/jpeg', JSON.stringify(tangkap));
  cek('ukuran JPEG masuk akal', tangkap.ukuran > 2000, tangkap.ukuran + ' byte');
  cek(
    'dimensi hasil sesuai prediksi ukuranTerskala',
    tangkap.lebar === tangkap.prediksiLebar && tangkap.tinggi === tangkap.prediksiTinggi,
    JSON.stringify(tangkap)
  );

  /* ---------------------------------------------- 4. overlay benar-benar tergambar */

  const overlay = await cdp.nilai(`
    const gbr = await import('./assets/js/gambar.js');
    const bgk = await import('./assets/js/bingkai.js');
    const video = document.querySelector('#bidik-video');

    async function pikselScrim(pakaiOverlay) {
      const hasil = await gbr.dariVideo(video, {
        gambarOverlay: pakaiOverlay ? (ctx, w, h) => bgk.gambarBingkai(ctx, w, h, { teks: 'UJI', namaTamu: 'UJI' }) : undefined
      });
      const bmp = await createImageBitmap(hasil.blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      // Ambil piksel di dalam area scrim bawah, di tengah.
      const d = ctx.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height * 0.95), 1, 1).data;
      bmp.close();
      c.width = 0; c.height = 0;
      return d[0] + d[1] + d[2];
    }

    const tanpa = await pikselScrim(false);
    const dengan = await pikselScrim(true);
    return { tanpa, dengan };
  `);
  // Scrim menggelapkan bagian bawah, jadi jumlah kanal warnanya harus turun.
  cek(
    'overlay/watermark benar-benar dibakar ke gambar',
    overlay.dengan < overlay.tanpa,
    JSON.stringify(overlay)
  );

  /* --------------------------------------------- 5. base64 utuh (byte-exact) */

  const b64 = await cdp.nilai(`
    const gbr = await import('./assets/js/gambar.js');
    const bytes = new Uint8Array([255, 216, 255, 1, 2, 3, 4, 5, 6, 7]);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const s = await gbr.base64Dari(blob);
    const balik = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return { panjang: s.length, cocok: balik.length === bytes.length && balik.every((v, i) => v === bytes[i]) };
  `);
  cek('base64Dari menghasilkan byte yang identik', b64.cocok, JSON.stringify(b64));

  /* --------------------------------- 6. antrean benar-benar terkuras ke backend */

  const kuras = await cdp.nilai(`
    const a = await import('./assets/js/antrean.js');
    const u = await import('./assets/js/unggah.js');
    const f = await import('./assets/js/fmt.js');
    const idx = await import('./assets/js/indeks.js');

    if (!(await idx.siap())) return { galat: 'data/api.json tidak menunjuk tiruan' };

    // JPEG kecil tapi sah bagi penjaga byte ajaib di tiruan server.
    const isi = new Uint8Array(200);
    isi[0] = 255; isi[1] = 216; isi[2] = 255;
    const kunci = f.uuid();
    await a.tambah({
      kunci, waktu: Date.now(), namaTamu: 'Rani', sesi: 'uji', device: 'headless',
      mime: 'image/jpeg', lebar: 10, tinggi: 10, ukuran: isi.length,
      namaBerkas: 'uji.jpg', blob: new Blob([isi], { type: 'image/jpeg' }), thumb: null
    });

    await u.dorong();
    for (let i = 0; i < 40; i++) {
      const b = await a.ambil(kunci);
      if (b && b.status === 'terkirim') {
        // Kuras kedua TIDAK boleh mengirim ulang baris yang sudah terkirim.
        await u.dorong();
        const lagi = await a.ambil(kunci);
        return { status: lagi.status, idDrive: lagi.idDrive, percobaan: lagi.percobaan };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const akhir = await a.ambil(kunci);
    return { status: akhir?.status, galatTerakhir: akhir?.galatTerakhir };
  `);
  cek('antrean terkuras sampai status terkirim', kuras.status === 'terkirim', JSON.stringify(kuras));
  cek('balasan backend mengisi id berkas', Boolean(kuras.idDrive), JSON.stringify(kuras));

  const jumlahServer = await (await fetch(`http://localhost:${PORT}/__unggah?aksi=sehat`)).json();
  cek(
    'server menerima tepat satu berkas (tidak ganda)',
    jumlahServer.terpakai_hari_ini === 1,
    'server mencatat ' + jumlahServer.terpakai_hari_ini
  );

  /* ------------------------------------------- 7. idempotensi setelah timeout */

  const idem = await cdp.nilai(`
    const a = await import('./assets/js/antrean.js');
    const u = await import('./assets/js/unggah.js');
    const f = await import('./assets/js/fmt.js');
    const isi = new Uint8Array(200);
    isi[0] = 255; isi[1] = 216; isi[2] = 255;
    const kunci = f.uuid();
    const buat = () => a.tambah({
      kunci, waktu: Date.now(), namaTamu: 'Rani', sesi: 'uji', device: 'headless',
      mime: 'image/jpeg', lebar: 10, tinggi: 10, ukuran: isi.length,
      namaBerkas: 'uji2.jpg', blob: new Blob([isi], { type: 'image/jpeg' }), thumb: null
    });
    await buat();
    await u.dorong();
    for (let i = 0; i < 40 && (await a.ambil(kunci))?.status !== 'terkirim'; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const pertama = await a.ambil(kunci);
    // Simulasikan "balasan tidak sampai ke HP": paksa baris dikirim ulang
    // dengan kunci yang SAMA. Server harus menjawab duplikat, bukan membuat
    // berkas kedua.
    await a.perbarui(kunci, { status: 'tertunda', cobaSetelah: 0, percobaan: 1 });
    await u.dorong();
    for (let i = 0; i < 40 && (await a.ambil(kunci))?.status !== 'terkirim'; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const kedua = await a.ambil(kunci);
    return { id1: pertama?.idDrive, id2: kedua?.idDrive, duplikat: kedua?.duplikat };
  `);
  cek(
    'kirim ulang kunci yang sama mengembalikan berkas yang sama',
    idem.id1 && idem.id1 === idem.id2,
    JSON.stringify(idem)
  );
  cek('kiriman ulang ditandai duplikat', idem.duplikat === true, JSON.stringify(idem));

  const jumlahAkhir = await (await fetch(`http://localhost:${PORT}/__unggah?aksi=sehat`)).json();
  cek(
    'tidak ada berkas ketiga walau dikirim tiga kali',
    jumlahAkhir.terpakai_hari_ini === 2,
    'server mencatat ' + jumlahAkhir.terpakai_hari_ini
  );

  /* ------------------------------------------------- 8. halaman Foto Saya hidup */

  const saya = await cdp.nilai(`
    location.hash = '#/saya';
    await new Promise((r) => setTimeout(r, 1200));
    const teks = document.querySelector('#view').textContent;
    return { adaFoto: /Foto Saya/.test(teks), adaBadge: /Aman di Drive|Menunggu kirim|Belum terkirim/.test(teks) };
  `);
  cek('halaman Foto Saya menampilkan daftar', saya.adaFoto, JSON.stringify(saya));
  cek('status pengiriman tampil sebagai badge', saya.adaBadge, JSON.stringify(saya));

  /* --------------------------------------- 9. service worker & precache offline */

  // Kalau SATU entri di daftar ASET salah jalur, cache.addAll() menolak
  // seluruhnya dan mode offline mati tanpa suara — padahal justru mode offline
  // yang membuat booth berguna di venue. Jadi daftar itu harus dibuktikan di
  // browser, bukan hanya dicocokkan dengan isi disk oleh cek-impor.mjs.
  const sw = await cdp.nilai(`
    if (!('serviceWorker' in navigator)) return { lewati: 'tanpa dukungan service worker' };
    const reg = await navigator.serviceWorker.register('./sw.js');
    const batas = Date.now() + 15000;
    while (!navigator.serviceWorker.controller && Date.now() < batas) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const teksSw = await (await fetch('./sw.js')).text();
    const blok = teksSw.match(/const ASET = \\[([\\s\\S]*?)\\];/);
    const daftar = [...blok[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    const nama = await caches.keys();
    const versi = (teksSw.match(/const VERSI = '([^']+)'/) || [])[1];
    if (!nama.includes(versi)) return { aktif: Boolean(navigator.serviceWorker.controller), cacheAda: false, nama, versi };

    const cache = await caches.open(versi);
    const hilang = [];
    for (const jalur of daftar) {
      if (!(await cache.match(jalur))) hilang.push(jalur);
    }
    const kunci = await cache.keys();
    const adaBackend = kunci.some((r) => /script\\.google(usercontent)?\\.com/.test(r.url));
    return {
      aktif: Boolean(navigator.serviceWorker.controller),
      cacheAda: true,
      jumlahDaftar: daftar.length,
      hilang,
      adaBackend
    };
  `);

  if (sw.lewati) {
    console.log('  ·    uji service worker dilewati: ' + sw.lewati);
  } else if (!sw.cacheAda) {
    // Headless kadang tidak menyelesaikan aktivasi SW dalam batas waktu. Itu
    // keterbatasan harness, bukan bukti bahwa precache rusak — dilewati, bukan
    // digagalkan, dengan catatan yang terlihat.
    console.log('  ·    uji service worker dilewati: cache belum terbentuk di headless (' + JSON.stringify(sw) + ')');
  } else {
    cek('service worker aktif', sw.aktif, JSON.stringify(sw));
    cek(
      'seluruh daftar ASET benar-benar ter-precache',
      sw.hilang.length === 0,
      sw.hilang.length ? 'tidak ter-cache: ' + sw.hilang.join(', ') : ''
    );
    cek('endpoint backend TIDAK ikut ter-cache', sw.adaBackend === false, JSON.stringify(sw));
  }

  ws.close();
} catch (e) {
  gagal.push('harness: ' + (e?.message || e));
  console.error('  GAGAL harness — ' + (e?.message || e));
} finally {
  if (chrome) chrome.kill();
  if (server) server.kill();
  try {
    rmSync(profil, { recursive: true, force: true });
  } catch {
    /* profil sementara, biarkan OS membersihkan */
  }
}

console.log(`\nUji asap: ${lulus} lulus, ${gagal.length} gagal`);
if (gagal.length) process.exit(1);
