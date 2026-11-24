// Uji asap untuk endpoint backend yang SUDAH ter-deploy.
//
//   node tools/cek-endpoint.mjs                              (baca data/api.json)
//   node tools/cek-endpoint.mjs --url https://.../exec --token xxx
//   node tools/cek-endpoint.mjs --berkas C:\foto\kecil.jpg   (pakai foto nyata)
//   node tools/cek-endpoint.mjs --bersih --admin yyy         (buang berkas uji)
//
// Yang dibuktikan di sini bukan "apakah Apps Script hidup", melainkan setiap
// asumsi yang dipegang aplikasi tamu:
//
//   1. URL di data/api.json menjalankan VERSI yang sama dengan apps-script/ lokal
//      — satu-satunya cara mendeteksi jebakan "Deploy > New deployment" yang
//      diam-diam menerbitkan URL baru dan meninggalkan booth di kode lama;
//   2. jendela acara benar-benar memuat 6 Desember 2026 09:00 Asia/Jakarta
//      (menangkap salah zona waktu yang kalau tidak akan terlihat tepat jam 9);
//   3. JPEG sungguhan diterima dan nama berkasnya mengikuti pola rekonsiliasi;
//   4. IDEMPOTENSI: kunci yang sama mengembalikan idBerkas yang SAMA;
//   5. lapis idempotensi yang awet (ulang=1), bukan hanya cache;
//   6. token salah ditolak DAN tidak membuat berkas;
//   7. bukan-JPEG ditolak.
//
// CATATAN KEJUJURAN: fetch di Node TIDAK menegakkan CORS, jadi semua uji di sini
// bisa hijau sementara jalur browser tetap putus. Lulus di sini membuktikan
// backend-nya; hanya HP sungguhan di halaman sungguhan yang membuktikan produknya.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');

function argumen() {
  const a = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (!v[i].startsWith('--')) continue;
    const nama = v[i].slice(2);
    const nilai = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true;
    a[nama] = nilai;
  }
  return a;
}

let lulus = 0;
const gagal = [];

function cek(nama, benar, detail = '') {
  if (benar) {
    lulus++;
    console.log('  ok   ' + nama);
    return true;
  }
  gagal.push(nama);
  console.error('  GAGAL ' + nama + (detail ? ' — ' + detail : ''));
  return false;
}

function info(nama, nilai) {
  console.log('  ·    ' + nama + ': ' + nilai);
}

/* ------------------------------------------------------------- fixture JPEG */

/**
 * JPEG 1x1 grayscale dirakit byte demi byte, dengan SEMUA panjang segmen
 * dihitung dari isinya.
 *
 * SENGAJA tidak memakai string base64 "JPEG terkecil" yang beredar di internet:
 * dua string paling populer itu rusak secara struktural (panjang segmen DQT
 * mengaku 67 byte padahal isinya kurang, dan jumlah kode DHT tidak cocok dengan
 * jumlah simbolnya). Decoder yang longgar tetap menampilkannya — karena itu
 * string-nya beredar — tapi uji ini tidak boleh bergantung pada kelonggaran
 * siapa pun. Kalau fixture-nya sendiri salah, kita harus tahu di sini, bukan
 * menyalahkan server.
 */
function buatJpegUji() {
  const seg = (penanda, muatan) => {
    const panjang = muatan.length + 2;
    return Buffer.concat([
      Buffer.from([0xff, penanda, (panjang >> 8) & 0xff, panjang & 0xff]),
      Buffer.from(muatan)
    ]);
  };

  const jfif = seg(0xe0, [
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, // versi 1.1
    0x00, // satuan: tanpa satuan
    0x00, 0x01, 0x00, 0x01, // kerapatan x,y
    0x00, 0x00 // tanpa thumbnail
  ]);

  const dqt = seg(0xdb, [0x00].concat(new Array(64).fill(0x10)));

  const sof0 = seg(0xc0, [
    0x08, // presisi 8 bit
    0x00, 0x01, // tinggi 1
    0x00, 0x01, // lebar 1
    0x01, // 1 komponen
    0x01, 0x11, 0x00 // id 1, sampling 1x1, tabel kuantisasi 0
  ]);

  // Satu kode sepanjang 1 bit ("0") untuk satu simbol (0x00). Jumlah kode dan
  // jumlah simbol dibuat cocok secara konstruksi.
  const hitungan = new Array(16).fill(0);
  hitungan[0] = 1;
  const dhtDc = seg(0xc4, [0x00].concat(hitungan, [0x00]));
  const dhtAc = seg(0xc4, [0x10].concat(hitungan, [0x00]));

  const sos = seg(0xda, [
    0x01, // 1 komponen
    0x01, 0x00, // komponen 1, tabel DC 0 / AC 0
    0x00, 0x3f, 0x00 // Ss, Se, Ah/Al
  ]);

  // DC kategori 0 -> kode "0"; EOB -> kode "0". Dua bit "00", sisanya diisi 1.
  const data = Buffer.from([0b00111111]);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jfif,
    dqt,
    sof0,
    dhtDc,
    dhtAc,
    sos,
    data,
    Buffer.from([0xff, 0xd9])
  ]);
}

/** Telusuri penanda dan buktikan setiap panjang segmen cocok dengan isinya. */
function periksaStrukturJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return 'tidak dimulai dengan SOI';
  let pos = 2;
  let adaSof = false;
  let adaSos = false;
  while (pos + 1 < buf.length) {
    if (buf[pos] !== 0xff) return 'penanda rusak di offset ' + pos;
    const penanda = buf[pos + 1];
    if (penanda === 0xd9) return adaSof && adaSos ? '' : 'EOI sebelum SOF/SOS';
    if (penanda === 0xda) {
      adaSos = true;
      const panjang = buf.readUInt16BE(pos + 2);
      pos += 2 + panjang;
      // Sesudah SOS ada data entropi sampai EOI; lompat ke EOI.
      while (pos + 1 < buf.length && !(buf[pos] === 0xff && buf[pos + 1] === 0xd9)) pos++;
      continue;
    }
    const panjang = buf.readUInt16BE(pos + 2);
    if (panjang < 2) return 'panjang segmen tidak sah di offset ' + pos;
    if (pos + 2 + panjang > buf.length) return 'segmen melewati akhir berkas di offset ' + pos;
    if (penanda === 0xc0) adaSof = true;
    if (penanda === 0xc4) {
      const isi = buf.subarray(pos + 4, pos + 2 + panjang);
      const jumlahKode = isi.subarray(1, 17).reduce((a, b) => a + b, 0);
      const jumlahSimbol = isi.length - 17;
      if (jumlahKode !== jumlahSimbol) {
        return `DHT: ${jumlahKode} kode tapi ${jumlahSimbol} simbol`;
      }
    }
    if (penanda === 0xdb) {
      const isi = buf.subarray(pos + 4, pos + 2 + panjang);
      if (isi.length !== 65) return 'DQT: panjang nilai kuantisasi bukan 64';
    }
    pos += 2 + panjang;
  }
  return 'tidak ada EOI';
}

/* ------------------------------------------------------------------ jalankan */

const arg = argumen();

function dariApiJson() {
  const p = join(AKAR, 'data', 'api.json');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return { url: j.dasar, token: j.token || '' };
}

function versiLokal() {
  const isi = readFileSync(join(AKAR, 'apps-script', 'Pengaturan.gs'), 'utf8');
  const m = isi.match(/VERSI:\s*'([^']*)'/);
  return m ? m[1] : '';
}

const konfig = dariApiJson();
const URL_EXEC = arg.url || konfig.url;
const TOKEN = arg.token || konfig.token;

if (!URL_EXEC) {
  console.log(
    'Belum ada endpoint. Isi "dasar" di data/api.json, atau jalankan dengan --url https://.../exec'
  );
  console.log('Backend belum dipasang bukan kegagalan: booth tetap bisa menjepret dan menyimpan ke galeri.');
  process.exit(0);
}

console.log('Endpoint: ' + URL_EXEC);
if (/script\.google\.com/.test(URL_EXEC) && !/\/exec$/.test(URL_EXEC)) {
  cek('URL berakhiran /exec (bukan /dev)', false, 'URL /dev hanya bisa diakses pemilik script');
}

const jpeg = arg.berkas && existsSync(arg.berkas) ? readFileSync(arg.berkas) : buatJpegUji();
const masalah = periksaStrukturJpeg(jpeg);
cek('fixture JPEG sah secara struktur', masalah === '', masalah);
info('ukuran fixture', jpeg.length + ' byte' + (arg.berkas ? ' (dari ' + arg.berkas + ')' : ' (dirakit)'));
const b64 = jpeg.toString('base64');

async function panggil(param, badan) {
  const u = new URL(URL_EXEC);
  for (const [k, v] of Object.entries(param)) u.searchParams.set(k, String(v));
  const opsi = badan
    ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: badan }
    : { method: 'GET' };
  const r = await fetch(u, { ...opsi, redirect: 'follow' });
  const teks = await r.text();
  try {
    return { status: r.status, data: JSON.parse(teks) };
  } catch {
    return { status: r.status, mentah: teks.slice(0, 300) };
  }
}

/* 1. sehat + kecocokan versi */
const sehat = await panggil({ aksi: 'sehat' });
if (sehat.mentah) {
  const login = /accounts\.google\.com|Sign in|Masuk ke Google/i.test(sehat.mentah);
  cek(
    'cek sehat menjawab JSON',
    false,
    login
      ? 'backend meminta LOGIN — deployment harus "Anyone, even anonymous"'
      : sehat.mentah
  );
} else {
  cek('cek sehat menjawab ok', sehat.data?.ok === true, JSON.stringify(sehat.data));

  // Tiruan di tools/serve.mjs sengaja mengaku "stub". Dua pemeriksaan di bawah
  // hanya bermakna terhadap deployment Apps Script sungguhan, jadi di mode
  // tiruan keduanya dilewati — bukan dilonggarkan — supaya tidak ada alarm palsu
  // yang membuat orang berhenti mempercayai alat ini.
  const tiruan = sehat.data?.versi === 'stub';
  if (tiruan) {
    console.log('  ·    MODE TIRUAN (tools/serve.mjs): uji versi dan jendela acara dilewati');
  } else {
    const lokal = versiLokal();
    info('versi lokal', lokal);
    info('versi hidup', sehat.data?.versi);
    cek(
      'versi yang hidup sama dengan apps-script/ lokal',
      Boolean(lokal) && sehat.data?.versi === lokal,
      'kalau beda: deployment lama masih dipakai — pakai Manage deployments > Edit > New version'
    );

    // Zona waktu yang salah tidak akan terlihat sampai tepat jam 9 pagi hari-H.
    const hariH = Date.parse('2026-12-06T09:00:00+07:00');
    const mulai = Date.parse(sehat.data?.jendela?.mulai || '');
    const selesai = Date.parse(sehat.data?.jendela?.selesai || '');
    cek(
      'jendela acara memuat 6 Des 2026 09:00 WIB',
      Number.isFinite(mulai) && Number.isFinite(selesai) && mulai <= hariH && hariH <= selesai,
      `${sehat.data?.jendela?.mulai} .. ${sehat.data?.jendela?.selesai}`
    );
  }

  cek('booth aktif', sehat.data?.aktif === true, 'saklar aktif di Sheet = TIDAK?');
}

/* 2. unggah */
const kunci = randomUUID();
const namaUji = "ZZ-UJI Ma'ruf 🌸";
const satu = await panggil({ aksi: 'unggah', t: TOKEN, kunci, nama: namaUji, perangkat: 'cek-endpoint' }, b64);

// Satu penolakan ini punya sebab yang sangat spesifik dan obat yang sangat
// spesifik pula. Tanpa pesan ini, ia muncul sebagai tiga kegagalan beruntun yang
// terlihat seperti backend rusak — padahal justru penjaganya yang bekerja.
if (satu.data?.kode === 'DI_LUAR_JENDELA') {
  console.error(
    '\n  BERHENTI: endpoint menolak karena di luar jendela acara.\n' +
      '  Ini bukan kerusakan — JENDELA_MULAI/SELESAI di Pengaturan.gs memang membuat\n' +
      '  endpoint mati di luar hari-H. Untuk latihan, tempel Pengaturan-UJI.local.gs\n' +
      '  (jendelanya sengaja dilebarkan sampai 7 Des), lalu deploy ulang lewat\n' +
      '  Manage deployments > Edit > New version — JANGAN "New deployment".\n'
  );
}

const berhasil = cek('unggah JPEG diterima', satu.data?.ok === true, JSON.stringify(satu.data || satu.mentah));

if (berhasil) {
  info('nama berkas', satu.data.namaBerkas);
  cek(
    'nama berkas cocok pola rekonsiliasi',
    /^\d{8}-\d{6}_.+_[a-z0-9]{8}\.jpg$/.test(satu.data.namaBerkas || ''),
    satu.data.namaBerkas
  );
  cek(
    'apostrof dibuang dan emoji tidak jadi deretan tanda hubung',
    !/--/.test(satu.data.namaBerkas || '') && !/['\u2019]/.test(satu.data.namaBerkas || ''),
    satu.data.namaBerkas
  );
  cek(
    'id pendek diturunkan dari kunci (syarat rekonsiliasi)',
    (satu.data.namaBerkas || '').endsWith(
      kunci.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() + '.jpg'
    ),
    satu.data.namaBerkas
  );

  /* 3. idempotensi lewat cache */
  const dua = await panggil({ aksi: 'unggah', t: TOKEN, kunci, nama: namaUji, perangkat: 'cek-endpoint' }, b64);
  cek(
    'kirim ulang kunci sama -> duplikat, berkas sama',
    dua.data?.ok === true && dua.data?.idBerkas === satu.data.idBerkas,
    JSON.stringify(dua.data || dua.mentah)
  );

  /* 4. idempotensi lewat Sheet (ulang=1) */
  const tiga = await panggil(
    { aksi: 'unggah', t: TOKEN, kunci, nama: namaUji, perangkat: 'cek-endpoint', ulang: 1 },
    b64
  );
  cek(
    'lapis awet (ulang=1) juga mengembalikan berkas sama',
    tiga.data?.idBerkas === satu.data.idBerkas,
    JSON.stringify(tiga.data || tiga.mentah)
  );
}

/* 5. token salah */
const tokenSalah = await panggil(
  { aksi: 'unggah', t: 'token-yang-salah', kunci: randomUUID(), nama: 'ZZ-UJI', perangkat: 'cek-endpoint' },
  b64
);
cek(
  'token salah ditolak dan tidak boleh dicoba ulang',
  tokenSalah.data?.ok === false && tokenSalah.data?.kode === 'TOKEN_SALAH' && tokenSalah.data?.ulangi === false,
  JSON.stringify(tokenSalah.data || tokenSalah.mentah)
);

/* 6. bukan JPEG */
const bukanJpeg = await panggil(
  { aksi: 'unggah', t: TOKEN, kunci: randomUUID(), nama: 'ZZ-UJI', perangkat: 'cek-endpoint' },
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]).toString('base64')
);
cek(
  'bukan JPEG ditolak',
  bukanJpeg.data?.ok === false && bukanJpeg.data?.kode === 'BUKAN_JPEG',
  JSON.stringify(bukanJpeg.data || bukanJpeg.mentah)
);

/* 7. terlalu kecil */
const kecil = await panggil(
  { aksi: 'unggah', t: TOKEN, kunci: randomUUID(), nama: 'ZZ-UJI', perangkat: 'cek-endpoint' },
  Buffer.from([0xff, 0xd8, 0xff]).toString('base64')
);
cek(
  'berkas terlalu kecil ditolak',
  kecil.data?.ok === false && kecil.data?.kode === 'TERLALU_KECIL',
  JSON.stringify(kecil.data || kecil.mentah)
);

/* 8. bersih-bersih opsional */
if (arg.bersih && arg.admin) {
  const buang = await panggil({ aksi: 'hapus_uji', t: TOKEN, admin: arg.admin });
  cek('berkas uji dibuang ke sampah', buang.data?.ok === true, JSON.stringify(buang.data || buang.mentah));
} else {
  console.log(
    '  ·    berkas uji BELUM dibuang. Jalankan ulang dengan --bersih --admin <token_admin>,'
  );
  console.log('       atau hapus manual berkas bernama ZZ-UJI dari folder Drive.');
}

console.log(`\nCek endpoint: ${lulus} lulus, ${gagal.length} gagal`);
if (gagal.length) process.exit(1);
