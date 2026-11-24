/**
 * Alat.gs — utilitas kecil yang dipakai semua berkas lain.
 */

/**
 * Balasan JSON.
 *
 * CATATAN YANG MENENTUKAN SELURUH DESAIN KLIEN: Apps Script tidak punya API
 * untuk mengatur kode status HTTP pada TextOutput. Balasan ini SELALU 200,
 * bahkan ketika script melempar exception (saat itu Google mengembalikan halaman
 * HTML galat, tetap dengan status 200). Karena itu klien tidak boleh pernah
 * menilai keberhasilan dari resp.ok — penilaian harus dari isi badan ini.
 */
function balasJson(obj) {
  obj.versi = PENGATURAN.VERSI;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function galat(kode, pesan, ulangi, tungguMs) {
  return {
    ok: false,
    kode: kode,
    pesan: pesan,
    ulangi: Boolean(ulangi),
    tunggu_ms: tungguMs || 0
  };
}

/** Tercatat di halaman Executions dan di Cloud Logging. */
function catat(tag, e) {
  try {
    console.error(tag + ': ' + (e && e.stack ? e.stack : String(e)));
  } catch (x) {
    /* jangan pernah gagal hanya karena pencatatan gagal */
  }
}

function sekarangJakarta() {
  return Utilities.formatDate(new Date(), PENGATURAN.ZONA_WAKTU, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function capWaktuBerkas() {
  return Utilities.formatDate(new Date(), PENGATURAN.ZONA_WAKTU, 'yyyyMMdd-HHmmss');
}

function kunciMenit() {
  return Utilities.formatDate(new Date(), PENGATURAN.ZONA_WAKTU, 'yyyyMMddHHmm');
}

function kunciHari() {
  return Utilities.formatDate(new Date(), PENGATURAN.ZONA_WAKTU, 'yyyyMMdd');
}

function potong(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) : s;
}

/** Jitter supaya ratusan HP yang ditolak bersamaan tidak mencoba lagi pada detik yang sama. */
function denganJitter(ms) {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}
