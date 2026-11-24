// Rute `#/saya` — "Foto Saya".
//
// Dibaca 100% dari IndexedDB, bukan dari Drive. Tiga alasan, semuanya penting:
//   1. Instan dan jalan tanpa internet — tepat keadaan tamu di venue.
//   2. Tidak ada satu pun permintaan ke drive.google.com/thumbnail, yang kena
//      rate-limit pada halaman dengan 10+ gambar dan akan menampilkan kotak
//      kosong justru saat tamu ingin memamerkan hasilnya.
//   3. Menjadi bukti bagi tamu bahwa fotonya ADA, lengkap dengan status
//      pengirimannya — ini yang membuat janji "nanti terkirim sendiri" dipercaya.

import { buat, el, notif, kebunUrl } from '../ui.js';
import { esc, jamSingkat, jumlahFoto } from '../fmt.js';
import * as antrean from '../antrean.js';
import { STATUS } from '../antrean.js';
import { cobaLagi, cobaLagiSemua, onPerubahan } from '../unggah.js';
import { simpanKeGaleri, simpanBanyak, MAKS_PER_BAGI, iniIos } from '../simpan-galeri.js';

export const judulHalaman = 'Foto Saya';

let taman = null;
let lepasPendengar = null;

export async function bongkar() {
  if (taman) taman.bersihkan();
  if (lepasPendengar) lepasPendengar();
  taman = null;
  lepasPendengar = null;
}

const LABEL = {
  [STATUS.TERTUNDA]: { teks: 'Menunggu kirim', kelas: 'tunda' },
  [STATUS.MENGIRIM]: { teks: 'Mengirim…', kelas: 'kirim' },
  [STATUS.TERKIRIM]: { teks: 'Aman di Drive', kelas: 'aman' },
  [STATUS.GAGAL]: { teks: 'Belum terkirim', kelas: 'gagal' }
};

export async function render(wadah) {
  taman = kebunUrl();
  const kepala = buat('div', { kelas: 'kepala-saya' });
  const grid = buat('div', { kelas: 'grid-foto' });
  wadah.append(kepala, grid);

  await gambar(kepala, grid);

  // Perbarui saat pengirim bergerak, supaya badge status tidak basi.
  lepasPendengar = onPerubahan(() => gambar(kepala, grid));
}

async function gambar(kepala, grid) {
  const semua = await antrean.ambilSemua();
  const r = antrean.ringkas(semua);

  kepala.innerHTML = `
    <h1>Foto Saya</h1>
    <p class="redup">${jumlahFoto(r.total)} dari perangkat ini${
      r.menunggu ? ` &middot; ${r.menunggu} menunggu terkirim` : ''
    }</p>
    <div class="baris-tombol">
      ${r.menunggu ? '<button id="kirim-semua" class="tombol halus">Kirim yang tertunda</button>' : ''}
      ${
        semua.some((x) => x.blob)
          ? '<button id="simpan-semua" class="tombol halus">Simpan semua ke galeri</button>'
          : ''
      }
    </div>
  `;

  const kirimSemua = el('#kirim-semua', kepala);
  if (kirimSemua) kirimSemua.addEventListener('click', () => cobaLagiSemua());

  const simpanSemua = el('#simpan-semua', kepala);
  if (simpanSemua) {
    // Daftar berkas dirakit SEKARANG, bukan di dalam handler: iOS membatalkan
    // share yang dipanggil setelah await panjang.
    const daftar = semua
      .filter((x) => x.blob)
      .slice(0, MAKS_PER_BAGI)
      .map((x) => ({ blob: x.blob, nama: x.namaBerkas || 'foto.jpg', kunci: x.kunci }));
    simpanSemua.addEventListener('click', () => {
      simpanBanyak(daftar).then(async ({ cara, dibatalkan, jumlah }) => {
        if (dibatalkan) return;
        if (cara === 'manual') {
          notif('Tahan tiap foto lalu pilih "Add to Photos".', 'info', 6000);
          return;
        }
        notif(`${jumlah} foto disimpan ke galeri.`, 'sukses');
        for (const d of daftar) {
          try {
            await antrean.perbarui(d.kunci, { keGaleri: true });
            await antrean.bersihkanBlob(d.kunci);
          } catch {
            /* tidak kritis */
          }
        }
      });
    });
  }

  grid.innerHTML = '';
  if (!semua.length) {
    grid.append(
      buat(
        'p',
        { kelas: 'redup tengah' },
        'Belum ada foto. Buka tab Foto dan tekan tombol besar untuk mulai.'
      )
    );
    return;
  }

  for (const baris of semua) {
    grid.append(kartuFoto(baris));
  }
}

function kartuFoto(baris) {
  const label = LABEL[baris.status] || LABEL[STATUS.TERTUNDA];
  const kartu = buat('figure', { kelas: 'kartu-foto' });
  const sumber = baris.thumb || baris.blob;

  kartu.innerHTML = `
    ${
      sumber
        ? `<img src="${taman.url(sumber)}" alt="Foto ${esc(jamSingkat(baris.waktu))}" loading="lazy">`
        : '<div class="tanpa-thumb">foto</div>'
    }
    <figcaption>
      <span class="badge ${label.kelas}">${label.teks}</span>
      <span class="redup kecil">${esc(jamSingkat(baris.waktu))}</span>
    </figcaption>
  `;

  const aksi = buat('div', { kelas: 'aksi-kartu' });

  if (baris.blob) {
    aksi.append(
      buat('button', {
        kelas: 'tombol mini',
        onclick: () => {
          simpanKeGaleri(baris.blob, baris.namaBerkas || 'foto.jpg').then(async ({ cara, dibatalkan }) => {
            if (dibatalkan) return;
            if (cara === 'manual') {
              notif(
                iniIos() ? 'Tahan foto lalu pilih "Add to Photos".' : 'Foto masuk folder Download.',
                'info',
                6000
              );
              return;
            }
            notif('Tersimpan ke galeri.', 'sukses');
            try {
              await antrean.perbarui(baris.kunci, { keGaleri: true });
              await antrean.bersihkanBlob(baris.kunci);
            } catch {
              /* tidak kritis */
            }
          });
        }
      }, 'Simpan')
    );
  }

  if (baris.status === STATUS.GAGAL || baris.status === STATUS.TERTUNDA) {
    aksi.append(
      buat('button', { kelas: 'tombol mini', onclick: () => cobaLagi(baris.kunci) }, 'Coba kirim')
    );
  }

  if (baris.urlDrive) {
    aksi.append(
      buat(
        'a',
        { kelas: 'tombol mini', href: baris.urlDrive, target: '_blank', rel: 'noopener' },
        'Buka di Drive'
      )
    );
  }

  kartu.append(aksi);

  if (baris.status === STATUS.GAGAL && baris.galatTerakhir) {
    kartu.append(buat('p', { kelas: 'redup kecil galat-pesan' }, baris.galatTerakhir));
  }

  return kartu;
}
