// Hasilkan berkas A4 siap cetak dari cetak/qr.html, tanpa membuka browser sendiri.
//
// Jalankan:
//   node tools/cetak-pdf.mjs                 -> poster, tanpa label sesi
//   node tools/cetak-pdf.mjs 8 meja-01       -> lembar 8 kartu, sesi "meja-01"
//   node tools/cetak-pdf.mjs semua akad      -> poster + 2 + 4 + 8 sekaligus
//
// MENGAPA PDF dan bukan PNG: QR di dalam PDF masih VEKTOR, jadi percetakan bisa
// membesarkannya ke A1 atau A0 tanpa kehilangan ketajaman sama sekali. PNG
// (tombol "Unduh PNG" di halaman) untuk WhatsApp, Instagram, dan undangan
// digital; PDF untuk apa pun yang keluar dari mesin cetak.
//
// MENGAPA lewat Chrome dan halaman yang sama, bukan perender PDF sendiri:
// perender kedua adalah perender yang bisa menyimpang dari yang dilihat di layar.
// Di sini yang tercetak benar-benar halaman yang sama, dengan CSS @page yang
// sama — tool ini hanya menekan tombol Cetak dari luar.

import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { slugNama } from '../assets/js/fmt.js';
import { modeLembar, NILAI_LEMBAR } from '../cetak/qr-inti.js';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8767;
const PORT_CDP = 9334;

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

const argMode = (process.argv[2] || 'poster').trim();
const argSesi = (process.argv[3] || '').trim();
const daftarMode = argMode === 'semua' ? NILAI_LEMBAR : [modeLembar(argMode).nilai];

function tunggu(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tungguSampai(fn, batasMs = 20000, jeda = 250) {
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

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nomor = 0;
    this.menunggu = new Map();
    ws.addEventListener('message', (ev) => {
      const pesan = JSON.parse(ev.data);
      const p = this.menunggu.get(pesan.id);
      if (!p) return;
      this.menunggu.delete(pesan.id);
      if (pesan.error) p.gagal(new Error(pesan.error.message));
      else p.selesai(pesan.result);
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

  async nilai(ekspresi) {
    const r = await this.kirim('Runtime.evaluate', {
      expression: `(async () => { ${ekspresi} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'galat di halaman');
    }
    return r.result.value;
  }
}

/**
 * Ukuran tiap halaman PDF, dibaca dari MediaBox.
 *
 * Ini buktinya, bukan harapan: A4 harus 595 x 842 titik (210 x 297 mm), dan
 * jumlah MediaBox adalah jumlah halaman. Lembar poster yang diam-diam menjadi
 * dua halaman — satu berisi QR, satu kosong — adalah kegagalan yang baru
 * ketahuan di percetakan.
 */
function halamanPdf(buf) {
  const teks = buf.toString('latin1');
  const kotak = [...teks.matchAll(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/g)];
  return kotak.map((m) => ({
    lebarMm: Math.round(((Number(m[3]) - Number(m[1])) / 72) * 25.4),
    tinggiMm: Math.round(((Number(m[4]) - Number(m[2])) / 72) * 25.4)
  }));
}

const browser = KANDIDAT.find((p) => existsSync(p));
if (!browser) {
  console.error('Chrome/Edge tidak ditemukan. Setel CHROME_PATH, atau buka');
  console.error('cetak/qr.html lalu tekan Cetak dan pilih "Simpan sebagai PDF".');
  process.exit(1);
}

const profil = mkdtempSync(join(tmpdir(), 'foto-nikah-pdf-'));
let server = null;
let chrome = null;
let gagal = 0;

try {
  server = spawn(process.execPath, [join(AKAR, 'tools', 'serve.mjs'), String(PORT)], {
    stdio: 'ignore'
  });

  const hidup = await tungguSampai(async () => {
    const r = await fetch(`http://localhost:${PORT}/cetak/qr.html`);
    return r.ok;
  }, 10000);
  if (!hidup) throw new Error('server lokal tidak mau hidup');

  chrome = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profil}`,
      `--remote-debugging-port=${PORT_CDP}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  const target = await tungguSampai(async () => {
    const r = await fetch(`http://localhost:${PORT_CDP}/json/list`);
    const daftar = await r.json();
    return daftar.find((t) => t.type === 'page');
  }, 20000);
  if (!target) throw new Error('target halaman tidak ditemukan lewat CDP');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((selesai, tolak) => {
    ws.addEventListener('open', selesai, { once: true });
    ws.addEventListener('error', () => tolak(new Error('WebSocket CDP gagal')), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.kirim('Runtime.enable');
  await cdp.kirim('Page.enable');

  for (const mode of daftarMode) {
    const alamat =
      `http://localhost:${PORT}/cetak/qr.html?n=${encodeURIComponent(mode)}` +
      (argSesi ? `&sesi=${encodeURIComponent(argSesi)}` : '');
    await cdp.kirim('Page.navigate', { url: alamat });

    const siap = await tungguSampai(() =>
      cdp.nilai(`
        const l = document.querySelector('#lembar');
        if (!l || !l.querySelector('.qr svg')) return null;
        return { jumlah: l.dataset.jumlah, kartu: l.querySelectorAll('.kartu').length };
      `)
    );
    if (!siap) throw new Error(`halaman cetak tidak selesai menggambar untuk n=${mode}`);

    // preferCSSPageSize: ikuti @page { size: A4 portrait; margin: 0 } milik
    // qr.css, bukan ukuran kertas bawaan Chrome. Tanpa ini, margin cetak bawaan
    // mengecilkan isi dan QR tidak lagi berukuran milimeter yang dirancang.
    const { data } = await cdp.kirim('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0
    });

    const label = argSesi ? slugNama(argSesi) : 'umum';
    const nama = `qr-a4-${mode}-${label}.pdf`;
    const tujuan = join(AKAR, nama);
    const buf = Buffer.from(data, 'base64');
    writeFileSync(tujuan, buf);

    const halaman = halamanPdf(buf);
    const a4 = halaman.length > 0 && halaman.every((h) => h.lebarMm === 210 && h.tinggiMm === 297);
    const satuHalaman = halaman.length === 1;
    const pdfSah = buf.subarray(0, 5).toString('ascii') === '%PDF-';

    if (!pdfSah || !a4 || !satuHalaman) gagal++;
    console.log(
      [
        pdfSah && a4 && satuHalaman ? 'ok   ' : 'GAGAL',
        nama.padEnd(28),
        `${siap.kartu} kartu`.padEnd(9),
        `${halaman.length} halaman`.padEnd(11),
        halaman.length ? `${halaman[0].lebarMm}x${halaman[0].tinggiMm} mm` : 'ukuran tidak terbaca',
        `${Math.round(buf.length / 1024)} KB`
      ].join('  ')
    );
  }

  ws.close();
} catch (e) {
  gagal++;
  console.error('GAGAL ' + (e?.message || e));
} finally {
  if (chrome) chrome.kill();
  if (server) server.kill();
  try {
    rmSync(profil, { recursive: true, force: true });
  } catch {
    /* profil sementara, biarkan OS membersihkan */
  }
}

process.exit(gagal ? 1 : 0);
