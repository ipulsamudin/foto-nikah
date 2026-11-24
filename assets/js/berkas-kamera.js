// Jalur cadangan: kamera HP bawaan dan galeri, lewat <input type="file">.
//
// Ini BUKAN keadaan darurat, ini jalur yang setara. Tiga alasannya nyata:
//   1. Jalan di mana pun, termasuk webview WhatsApp/Instagram yang sering
//      menolak getUserMedia tanpa penjelasan.
//   2. Di Android, app kamera bawaan menyimpan foto aslinya ke galeri secara
//      OTOMATIS — separuh janji produk ini terpenuhi gratis.
//   3. Tidak butuh alur izin kamera sama sekali.
//
// Dua input terpisah, meniru PhotoUploadButton.vue di goofy-report: satu dengan
// `capture` untuk memotret sekarang, satu tanpa `capture` untuk memilih foto
// yang sudah ada. Dukungan atribut `capture` tidak seragam antar browser, dan
// membiarkan tamu memilih maksudnya sendiri jauh lebih andal daripada menebak.

/**
 * Pasang kedua input tersembunyi ke dalam `induk`.
 *
 * @returns {{bukaKamera:Function, bukaGaleri:Function, lepas:Function}}
 */
export function pasangPemilih(induk, onBerkas) {
  const inputKamera = document.createElement('input');
  inputKamera.type = 'file';
  inputKamera.accept = 'image/*';
  inputKamera.setAttribute('capture', 'environment');
  inputKamera.hidden = true;

  const inputGaleri = document.createElement('input');
  inputGaleri.type = 'file';
  inputGaleri.accept = 'image/*';
  inputGaleri.multiple = true;
  inputGaleri.hidden = true;

  async function tangani(ev) {
    const berkas = Array.from(ev.target.files || []);
    // Reset lebih dulu: memilih berkas yang sama dua kali tidak memicu `change`
    // di beberapa browser, dan tamu akan mengira tombolnya rusak.
    ev.target.value = '';
    for (const f of berkas) await onBerkas(f);
  }

  inputKamera.addEventListener('change', tangani);
  inputGaleri.addEventListener('change', tangani);
  induk.append(inputKamera, inputGaleri);

  return {
    bukaKamera: () => inputKamera.click(),
    bukaGaleri: () => inputGaleri.click(),
    lepas: () => {
      inputKamera.remove();
      inputGaleri.remove();
    }
  };
}
