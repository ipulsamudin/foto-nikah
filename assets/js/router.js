// Router hash seperlunya saja.
//
// PERINGATAN YANG MEMBENTUK SELURUH NAVIGASI APLIKASI INI: di PWA standalone
// iOS, izin kamera dicabut setiap kali hash berubah. Karena itu beranda, layar
// jepret, dan layar hasil berada di SATU rute (`#/`) dan ditukar lewat DOM —
// menjepret tidak pernah melewati perubahan hash. Hash hanya berubah untuk
// "Foto Saya" dan "Info", dan saat itu stream kamera memang dimatikan.
// Jangan memindahkan layar jepret ke rute tersendiri.

let rute = {};
let viewSekarang = null;

export function jalur() {
  const h = location.hash.replace(/^#/, '');
  return h || '/';
}

export function ke(p) {
  if (jalur() === p) return render();
  location.hash = p;
}

async function render() {
  const p = jalur();
  const view = rute[p] || rute['*'];
  if (!view) return;

  // Setiap view boleh mengekspor bongkar(): mematikan kamera, mencabut object
  // URL, melepas pendengar. Dipanggil SEBELUM view berikutnya dirender.
  if (viewSekarang && typeof viewSekarang.bongkar === 'function') {
    try {
      await viewSekarang.bongkar();
    } catch {
      /* jangan pernah menghalangi navigasi karena pembongkaran gagal */
    }
  }

  const wadah = document.querySelector('#view');
  wadah.innerHTML = '';
  viewSekarang = view;
  document.body.dataset.rute = p;
  await view.render(wadah);
  window.scrollTo(0, 0);
}

export function mulaiRouter(tabelRute) {
  rute = tabelRute;
  addEventListener('hashchange', render);
  return render();
}
