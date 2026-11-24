// Antrean unggah di perangkat tamu — bagian paling penting di seluruh aplikasi.
//
// Aturan yang membentuk modul ini: FOTO TAMU TIDAK BOLEH HILANG. Wifi venue akan
// padat, tamu akan menutup tab di tengah unggahan, dan sinyal akan hilang di
// tengah acara. Maka foto disimpan DULU ke IndexedDB, baru dikirim. Kalau
// pengiriman gagal, catatannya tetap ada dan dicoba lagi — termasuk setelah
// halaman ditutup dan dibuka ulang keesokan harinya.
//
// Blob full-res dibuang setelah dua syarat terpenuhi (sudah mendarat di Drive DAN
// sudah disimpan ke galeri HP), tapi thumbnail 320px disimpan permanen supaya
// halaman "Foto Saya" tetap berisi tanpa menghabiskan penyimpanan HP.

const NAMA_DB = 'foto-nikah';
const VERSI_DB = 1;
const STORE = 'antrean';

/** Baris yang macet di status "mengirim" lebih lama dari ini dianggap tertunda lagi. */
const BATAS_MACET_MS = 120_000;

export const STATUS = {
  TERTUNDA: 'tertunda',
  MENGIRIM: 'mengirim',
  TERKIRIM: 'terkirim',
  GAGAL: 'gagal',
};

let dbPromise = null;

export function bukaDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((selesai, gagal) => {
    const req = indexedDB.open(NAMA_DB, VERSI_DB);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'kunci' });
        store.createIndex('status', 'status');
        store.createIndex('waktu', 'waktu');
      }
    };
    req.onsuccess = () => selesai(req.result);
    req.onerror = () => gagal(req.error || new Error('IndexedDB tidak bisa dibuka'));
  });
  return dbPromise;
}

function transaksi(mode) {
  return bukaDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function janji(req) {
  return new Promise((selesai, gagal) => {
    req.onsuccess = () => selesai(req.result);
    req.onerror = () => gagal(req.error);
  });
}

/**
 * Minta browser memperlakukan penyimpanan ini sebagai persisten.
 *
 * Tanpa ini, browser boleh membuang IndexedDB kapan saja saat penyimpanan HP
 * menipis — dan yang terbuang adalah foto tamu yang belum terkirim. Dipanggil
 * sekali saat aplikasi mulai; kalau ditolak, aplikasi tetap jalan.
 */
export async function mintaPenyimpananPersisten() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* diamkan: ini hanya optimasi, bukan syarat */
  }
  return false;
}

export async function tambah(catatan) {
  const store = await transaksi('readwrite');
  const baris = {
    status: STATUS.TERTUNDA,
    percobaan: 0,
    galatTerakhir: '',
    idDrive: '',
    urlDrive: '',
    keGaleri: false,
    cobaSetelah: 0,
    mulaiKirim: 0,
    ...catatan,
  };
  await janji(store.add(baris));
  return baris;
}

export async function ambil(kunci) {
  const store = await transaksi('readonly');
  return janji(store.get(kunci));
}

/** Semua catatan, terbaru dulu — dipakai halaman "Foto Saya". */
export async function ambilSemua() {
  const store = await transaksi('readonly');
  const semua = await janji(store.getAll());
  return semua.sort((a, b) => b.waktu - a.waktu);
}

export async function perbarui(kunci, tambalan) {
  const store = await transaksi('readwrite');
  const lama = await janji(store.get(kunci));
  if (!lama) return null;
  const baru = { ...lama, ...tambalan };
  await janji(store.put(baru));
  return baru;
}

export async function hapus(kunci) {
  const store = await transaksi('readwrite');
  return janji(store.delete(kunci));
}

/**
 * Pilih catatan yang layak dikirim sekarang. Fungsi murni supaya bisa diuji
 * tanpa browser (lihat tools/selftest.mjs).
 *
 * Status "mengirim" sengaja ikut dipertimbangkan: kalau tab mati di tengah
 * kirim, ada baris yang tertinggal berstatus "mengirim" selamanya. Baris seperti
 * itu dianggap tertunda kembali setelah dua menit tidak bergerak — kalau ternyata
 * fotonya memang sudah sampai Drive, idempotensi di server yang menyelamatkan:
 * kunci yang sama tidak membuat berkas kedua.
 */
export function pilihLayak(semua, sekarang = Date.now()) {
  return semua
    .filter((r) => r.status !== STATUS.TERKIRIM)
    .filter((r) => r.status !== STATUS.MENGIRIM || sekarang - (r.mulaiKirim || 0) > BATAS_MACET_MS)
    .filter((r) => (r.cobaSetelah || 0) <= sekarang)
    .sort((a, b) => a.waktu - b.waktu);
}

/** Catatan berikutnya yang layak dikirim, atau null. Yang tertua didahulukan. */
export async function berikutnya(sekarang = Date.now()) {
  const layak = pilihLayak(await ambilSemua(), sekarang);
  return layak[0] || null;
}

/**
 * Pulihkan baris yang tertinggal berstatus "mengirim" saat aplikasi dibuka.
 *
 * Status "mengirim" sebenarnya sebuah sewa, bukan keadaan permanen: kalau tab
 * dimatikan di tengah unggahan, baris itu tidak akan pernah bergerak sendiri dan
 * tamu melihat "Mengirim…" selamanya. Dipanggil sekali saat boot.
 *
 * Konsekuensinya satu foto bisa terkirim dua kali — dan itu sebabnya `kunci`
 * dikirim pada setiap percobaan dan server wajib idempoten terhadapnya.
 * Percobaan tidak di-reset: kita tidak ingin kehilangan jejak berapa kali baris
 * ini sudah mencoba.
 */
export async function pulihkanMacet() {
  const semua = await ambilSemua();
  let jumlah = 0;
  for (const r of semua) {
    if (r.status === STATUS.MENGIRIM) {
      await perbarui(r.kunci, { status: STATUS.TERTUNDA, mulaiKirim: 0 });
      jumlah++;
    }
  }
  return jumlah;
}

export function ringkas(semua) {
  return {
    total: semua.length,
    menunggu: semua.filter((r) => r.status !== STATUS.TERKIRIM).length,
    terkirim: semua.filter((r) => r.status === STATUS.TERKIRIM).length,
    gagal: semua.filter((r) => r.status === STATUS.GAGAL).length,
  };
}

export async function hitung() {
  return ringkas(await ambilSemua());
}

/**
 * Lepas blob full-res yang sudah tidak dibutuhkan.
 *
 * Syaratnya dua-duanya: sudah mendarat di Drive DAN tamu sudah menyimpannya ke
 * galeri. Kalau salah satu belum, blob dipertahankan — tamu masih mungkin
 * menekan "Simpan ke galeri" nanti, dan itu butuh berkas aslinya.
 */
export async function bersihkanBlob(kunci) {
  const r = await ambil(kunci);
  if (!r || !r.blob) return false;
  if (r.status !== STATUS.TERKIRIM || !r.keGaleri) return false;
  await perbarui(kunci, { blob: null });
  return true;
}
