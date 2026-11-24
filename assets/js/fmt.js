// Fungsi murni: tidak menyentuh DOM, tidak menyentuh jaringan, tidak menyimpan apa pun.
// Semua yang ada di sini diuji oleh tools/selftest.mjs tanpa browser — itu sebabnya
// berkas ini sengaja tidak mengimpor modul lain.

/** UUID v4. Dipakai sebagai `kunci` idempotensi: dibuat SEBELUM kirim, tidak pernah berubah antar retry. */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Cadangan untuk browser lama / konteks non-secure (uji lokal lewat http).
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

/**
 * Nama tamu → potongan aman untuk nama berkas Drive.
 *
 * Tamu mengisi nama sendiri, jadi isinya bisa apa saja: emoji, tanda kutip, garis
 * miring, spasi berlebih, atau 200 karakter. Drive menerima hampir semuanya, tapi
 * nama berkas yang mengandung `/` atau emoji menyusahkan saat folder diunduh ke
 * Windows. Maka dinormalkan di sini, sekali, sebelum dikirim.
 */
export function slugNama(teks) {
  let s = String(teks ?? '').trim();
  if (!s) return 'Tamu';

  try {
    s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); // é → e
  } catch {
    /* normalize tidak ada di runtime kuno: lanjut tanpa itu */
  }

  // Apostrof DIBUANG, bukan diganti tanda hubung. Nama Indonesia penuh apostrof:
  // Ma'ruf, Nur'aini, Sa'adah. "Ma-ruf" terbaca aneh, "Maruf" terbaca benar.
  // Termasuk apostrof melengkung yang disisipkan papan tombol HP secara otomatis.
  s = s.replace(/['’ʼ՚]/g, '');

  // Daftar-putih, lalu kerutkan. Urutannya penting: satu emoji adalah pasangan
  // surrogate (2 unit kode) dan emoji keluarga bisa 7+ unit dengan ZWJ, jadi
  // mengganti per unit menghasilkan banyak tanda hubung. Pengerutan HARUS
  // sesudah substitusi — dengan begitu kita tidak perlu regex emoji sama sekali.
  s = s
    .replace(/[^A-Za-z0-9]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (s.length > 40) {
    s = s.slice(0, 40);
    const batas = s.lastIndexOf('-');
    if (batas > 12) s = s.slice(0, batas); // potong di batas kata bila memungkinkan
    s = s.replace(/-+$/, '');
  }

  // Nama yang seluruhnya Arab/Mandarin/emoji akan habis. Jangan hasilkan nama
  // berkas kosong; nama ASLI tetap tercatat di kolom Sheet, jadi mempelai masih
  // bisa mengucapkan terima kasih dengan ejaan yang benar.
  return s || 'Tamu';
}

function duaAngka(n) {
  return String(n).padStart(2, '0');
}

/** Cap waktu lokal `YYYYMMDD-HHMMSS` — supaya berkas terurut waktu saat di-sort nama. */
export function capWaktu(waktu) {
  const d = waktu instanceof Date ? waktu : new Date(waktu);
  return (
    `${d.getFullYear()}${duaAngka(d.getMonth() + 1)}${duaAngka(d.getDate())}` +
    `-${duaAngka(d.getHours())}${duaAngka(d.getMinutes())}${duaAngka(d.getSeconds())}`
  );
}

/**
 * Potongan id yang ikut ke nama berkas. SENGAJA diturunkan dari `kunci`
 * idempotensi, bukan acak.
 *
 * Ini menanggung beban nyata: karena id-nya turunan, setiap berkas di Drive bisa
 * dilacak ke baris Sheet-nya dan ke catatan antrean di HP tamu tanpa perlu
 * pencarian. Kalau baris Sheet-nya hilang (lock indeks penuh saat ramai), folder
 * Drive masih bisa dibaca sendiri dan indeksnya bisa dibangun ulang dari nama
 * berkas. Id acak justru membuat Drive dan Sheet saling tidak bisa dicocokkan
 * tepat ketika keduanya harus dicocokkan.
 */
export function idPendek(kunci) {
  return String(kunci ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() || '00000000';
}

/** `20261206-101532_Rani-Agustina_a3f9c1d2.jpg` */
export function namaBerkas({ waktu, nama, kunci, ekstensi = 'jpg' }) {
  return `${capWaktu(waktu)}_${slugNama(nama)}_${idPendek(kunci)}.${ekstensi}`;
}

/**
 * Jeda sebelum percobaan ke-n (n mulai dari 1).
 *
 * Wifi venue padat: retry cepat berturut-turut hanya memperburuk antrean. Tangga
 * ini naik cepat lalu menetap di 10 menit, dan TIDAK pernah berhenti — foto tamu
 * lebih baik terkirim telat daripada hilang.
 */
export const TANGGA_BACKOFF = [2_000, 5_000, 15_000, 45_000, 120_000, 300_000, 600_000];

export function backoffMs(percobaan, acak = Math.random) {
  const i = Math.min(Math.max(percobaan, 1), TANGGA_BACKOFF.length) - 1;
  const dasar = TANGGA_BACKOFF[i];
  // Jitter ±20% supaya 30 HP yang gagal bersamaan tidak retry pada milidetik yang sama.
  return Math.round(dasar * (0.8 + 0.4 * acak()));
}

export function ukuranSingkat(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function jamSingkat(waktu) {
  const d = waktu instanceof Date ? waktu : new Date(waktu);
  return `${duaAngka(d.getHours())}:${duaAngka(d.getMinutes())}`;
}

/** Escape untuk disisipkan ke innerHTML. Nama tamu masuk ke DOM, jadi ini wajib. */
export function esc(teks) {
  return String(teks ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "3 foto" / "1 foto" — bahasa Indonesia tidak punya bentuk plural, tapi teksnya tetap dipusatkan di sini. */
export function jumlahFoto(n) {
  return `${n} foto`;
}
