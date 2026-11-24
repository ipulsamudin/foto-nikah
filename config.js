// Semua yang mungkin perlu diubah sepuluh menit sebelum acara ada di berkas ini.
//
// URL backend TIDAK di sini — tempatnya data/api.json, mengikuti pola "satu
// kontrak, dua backend" dari kontrakan-voting, supaya halaman dan alat uji tidak
// pernah menunjuk endpoint yang berbeda.
window.FOTO_NIKAH = {
  versi: '2026-12-06.1',

  acara: {
    mempelai: 'Syaiful & Sarah',
    tanggalTampil: 'Minggu, 6 Desember 2026',
    tanggalSingkat: '6 . 12 . 2026',
    lokasi: 'Basecamp Konsep Depok',
    teksWatermark: 'Syaiful & Sarah · 6 . 12 . 2026'
  },

  // Folder Drive yang dibagikan ke tamu. Biarkan kosong bila foldernya privat:
  // tombol album otomatis tidak ditampilkan.
  //
  // Folder ini memang dibagikan "Anyone with the link = Viewer", dan link-nya
  // memang diberikan ke semua tamu — jadi menuliskannya di sini tidak membocorkan
  // apa pun yang tidak sudah sengaja dibagikan. Konsekuensinya tetap perlu
  // diingat: siapa pun yang menerima link ini, termasuk dari tamu yang
  // meneruskannya, bisa melihat dan mengunduh seluruh foto.
  albumUrl: 'https://drive.google.com/drive/folders/1Gb-Vd7dFAgYqkhq8AufP_jyUuzaFhq0B',

  // Tautan kembali ke undangan digital, bila ingin ditampilkan.
  undanganUrl: '',

  // false = jepret tanpa bingkai/watermark.
  watermark: true,

  // Nomor yang dicetak di kartu QR sebagai jalan terakhir bila booth mogok.
  bantuanWa: ''
};
