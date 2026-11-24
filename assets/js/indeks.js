// Satu-satunya pintu keluar ke backend.
//
// Mengikuti pola "satu kontrak, dua backend" dari kontrakan-voting: URL backend
// hanya ada di data/api.json, dibaca di satu tempat (di sini), supaya halaman dan
// CI tidak pernah berbeda. Mengganti Apps Script dengan Cloudflare Worker nanti
// cukup menyentuh berkas ini + data/api.json, bukan seluruh aplikasi.
//
// Catatan CORS yang menentukan bentuk fungsi kirim():
//   Apps Script tidak bisa menjawab preflight OPTIONS. Maka request HARUS tetap
//   berupa "simple request": tanpa header kustom, dan Content-Type dibatasi ke
//   text/plain. Jadi semua metadata dikirim lewat query string, dan badan request
//   hanya berisi base64 JPEG. Jangan pernah menambahkan header di sini — satu
//   header kustom saja akan memicu preflight dan mematikan seluruh unggahan.

const JALUR_KONFIG = './data/api.json';

/** Unggahan diberi waktu lebih panjang: foto 1 MB di wifi venue bisa lambat sekali. */
const TIMEOUT_UNGGAH_MS = 120_000;
const TIMEOUT_RINGAN_MS = 15_000;

let konfigPromise = null;

export function muatKonfig() {
  if (konfigPromise) return konfigPromise;
  konfigPromise = fetch(JALUR_KONFIG, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('data/api.json tidak terbaca'))))
    .catch(() => ({ dasar: null, token: '' }));
  return konfigPromise;
}

/**
 * Apakah backend sudah dikonfigurasi?
 *
 * `dasar: null` adalah keadaan sah, bukan error: booth tetap boleh menjepret dan
 * menyimpan ke galeri + antrean, pengiriman saja yang ditahan sampai URL diisi.
 * Ini yang membuat aplikasi bisa dibangun dan diuji sebelum Apps Script ada.
 */
export async function siap() {
  const k = await muatKonfig();
  return Boolean(k?.dasar);
}

async function urlAksi(aksi, param = {}, { pakaiToken = true } = {}) {
  const k = await muatKonfig();
  if (!k?.dasar) throw new GalatBackend('BELUM_DIATUR', 'URL backend belum diisi di data/api.json');
  const u = new URL(k.dasar);
  u.searchParams.set('aksi', aksi);
  if (pakaiToken && k.token) u.searchParams.set('t', k.token);
  for (const [nama, nilai] of Object.entries(param)) {
    if (nilai !== undefined && nilai !== null && nilai !== '') u.searchParams.set(nama, String(nilai));
  }
  return u.toString();
}

export class GalatBackend extends Error {
  constructor(kode, pesan, { permanen = false, tungguMs = 0 } = {}) {
    super(pesan || kode);
    this.name = 'GalatBackend';
    this.kode = kode;
    // `permanen` menentukan apakah retry masuk akal. Token salah atau berkas
    // bukan JPEG tidak akan berubah hasilnya walau dicoba seribu kali; jaringan
    // mati jelas sebaliknya.
    this.permanen = permanen;
    // Server boleh menentukan sendiri kapan klien mencoba lagi. Itu membuat
    // kebijakan retry bisa disetel di tengah acara dari sisi backend, tanpa
    // men-deploy ulang PWA ke ratusan HP tamu.
    this.tungguMs = tungguMs;
  }
}

/** Kode yang tidak akan pernah berubah hasilnya; dipakai bila server tidak mengirim `ulangi`. */
const KODE_PERMANEN = new Set([
  'TOKEN_SALAH',
  'BUKAN_JPEG',
  'TERLALU_KECIL',
  'PARAM_KURANG',
  'DI_LUAR_JENDELA',
]);

/**
 * Apps Script tidak punya API untuk mengatur kode status HTTP: balasan
 * ContentService SELALU 200, bahkan saat script-nya melempar exception. Jadi
 * `resp.ok` tidak membawa informasi apa pun dan keputusan HARUS diambil dari
 * isi badan balasan. Fungsi ini satu-satunya tempat yang menafsirkannya.
 */
async function bacaJson(resp) {
  const teks = await resp.text();
  try {
    return JSON.parse(teks);
  } catch {
    // Apps Script menjawab HTML, bukan JSON. Dua penyebab yang paling mungkin,
    // dan membedakannya menghemat berjam-jam menyalahkan CORS:
    if (/accounts\.google\.com|Sign in|Masuk ke Google/i.test(teks)) {
      throw new GalatBackend(
        'PERLU_LOGIN',
        'Web App Apps Script belum di-deploy dengan akses "Anyone, even anonymous". ' +
          'Backend meminta login, sehingga tamu tidak akan pernah bisa mengirim foto.',
        { permanen: true },
      );
    }
    throw new GalatBackend('BUKAN_JSON', `Backend menjawab bukan JSON: ${teks.slice(0, 160)}`);
  }
}

async function panggil(url, opsi, timeoutMs) {
  const pembatal = new AbortController();
  const jam = setTimeout(() => pembatal.abort(), timeoutMs);
  try {
    // redirect:'follow' wajib: /exec menjawab 302 ke script.googleusercontent.com
    // dan balasan doPost yang sebenarnya menunggu di ujung redirect itu.
    const resp = await fetch(url, { ...opsi, signal: pembatal.signal, redirect: 'follow' });
    const data = await bacaJson(resp);
    if (data && data.ok === false) {
      // Hormati keputusan server lebih dulu; daftar lokal hanya cadangan.
      const permanen = data.ulangi === undefined ? KODE_PERMANEN.has(data.kode) : !data.ulangi;
      throw new GalatBackend(data.kode || 'DITOLAK', data.pesan || 'Ditolak backend', {
        permanen,
        tungguMs: Number(data.tunggu_ms) || 0,
      });
    }
    return data;
  } catch (e) {
    if (e instanceof GalatBackend) throw e;
    if (e?.name === 'AbortError') throw new GalatBackend('TIMEOUT', 'Backend tidak menjawab tepat waktu');
    // Kegagalan jaringan dan kegagalan CORS tampak identik ("Failed to fetch").
    // Menebak di antara keduanya hanya berujung foto yang dibuang, jadi keduanya
    // selalu dianggap bisa dicoba ulang.
    throw new GalatBackend('JARINGAN', e?.message || 'Jaringan bermasalah');
  } finally {
    clearTimeout(jam);
  }
}

/**
 * Kirim satu foto.
 *
 * `kunci` adalah kunci idempotensi: dibuat sebelum kirim dan tidak berubah antar
 * retry, sehingga unggahan yang terulang setelah timeout tidak menghasilkan
 * berkas kedua di Drive. Konvensi ini sejalan dengan `client_uuid` / header
 * X-Client-Uuid yang sudah dipakai di goofy-report.
 */
export async function kirimFoto({ kunci, nama, sesi, device, mime, lebar, tinggi, base64, ulang }) {
  const url = await urlAksi('unggah', {
    kunci,
    nama,
    sesi,
    perangkat: device,
    mime,
    w: lebar,
    h: tinggi,
    // `ulang=1` memberi tahu server bahwa ini percobaan ke-n, sehingga server
    // boleh membayar pencarian duplikat yang lebih mahal (lewat Sheet) alih-alih
    // hanya mengandalkan cache yang bisa ter-evict.
    ulang: ulang ? 1 : '',
  });
  return panggil(
    url,
    {
      method: 'POST',
      // text/plain = simple request = tidak ada preflight. Jangan diubah, dan
      // jangan menambah header apa pun di sini.
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: base64,
    },
    TIMEOUT_UNGGAH_MS,
  );
}

/**
 * Cek kesehatan — SENGAJA tanpa token.
 *
 * Supaya halaman Diagnosa dan tools/cek-endpoint.mjs bisa membedakan "backend
 * mati" dari "token salah". Balasannya juga membawa `versi`, yang dipakai untuk
 * membuktikan bahwa URL di data/api.json benar-benar menjalankan kode terbaru —
 * satu-satunya cara mendeteksi jebakan "Deploy → New deployment" yang diam-diam
 * menerbitkan URL baru dan meninggalkan booth berjalan di kode lama.
 */
export async function cekSehat() {
  return panggil(await urlAksi('sehat', {}, { pakaiToken: false }), { method: 'GET' }, TIMEOUT_RINGAN_MS);
}

/** Opsional: strip foto terbaru di halaman Acara. Boleh gagal tanpa merusak apa pun. */
export async function fotoTerbaru(n = 24) {
  return panggil(await urlAksi('terbaru', { n }), { method: 'GET' }, TIMEOUT_RINGAN_MS);
}
