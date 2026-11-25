// Bingkai & watermark, digambar dengan primitif Canvas 2D.
//
// SENGAJA tidak menempelkan gambar PNG/SVG, dan sengaja tidak memakai webfont:
//   - createImageBitmap pada blob SVG bermasalah di Safari, dan SVG tanpa
//     width/height intrinsik tidak bisa di-drawImage sama sekali;
//   - teks kanvas dengan webfont diam-diam jatuh ke font sistem bila font belum
//     termuat, sehingga hasil jepretan pertama bisa berbeda dari jepretan
//     berikutnya tanpa alasan yang terlihat.
// Semua ukuran proporsional terhadap tinggi gambar, jadi hasilnya sama di
// resolusi apa pun.

const EMAS = '#C9A66B';

export function gambarBingkai(ctx, w, h, { teks = '', namaTamu = '' } = {}) {
  // Ukuran teks dan ornamen diikatkan ke SISI PENDEK, bukan ke tinggi.
  //
  // Sejak viewfinder boleh portrait maupun landscape, memakai tinggi membuat
  // watermark terlihat besar di foto tegak dan mengecil di foto miring — padahal
  // keduanya dicetak berdampingan di album yang sama. Sisi pendek membuat
  // ukurannya terasa sama di kedua orientasi.
  const sisi = Math.min(w, h);
  const satuan = sisi / 1000;

  // Scrim gelap di bagian bawah: menjamin teks tetap terbaca di atas gaun putih
  // maupun latar gelap. Tanpa ini, watermark hilang di separuh foto.
  const tinggiScrim = h * 0.18;
  const gradien = ctx.createLinearGradient(0, h - tinggiScrim, 0, h);
  gradien.addColorStop(0, 'rgba(0,0,0,0)');
  gradien.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = gradien;
  ctx.fillRect(0, h - tinggiScrim, w, tinggiScrim);

  // Ornamen sudut: dua garis emas tipis di setiap sudut.
  const panjang = sisi * 0.07;
  const tepi = sisi * 0.035;
  ctx.strokeStyle = EMAS;
  ctx.lineWidth = Math.max(1, 3 * satuan);
  ctx.globalAlpha = 0.9;
  for (const [x, y, dx, dy] of [
    [tepi, tepi, 1, 1],
    [w - tepi, tepi, -1, 1],
    [tepi, h - tepi, 1, -1],
    [w - tepi, h - tepi, -1, -1]
  ]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * panjang, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * panjang);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 8 * satuan;

  if (teks) {
    ctx.font = `${Math.round(sisi * 0.032)}px Georgia, "Times New Roman", serif`;
    ctx.fillText(teks, w / 2, h - h * 0.055);
  }
  if (namaTamu) {
    ctx.globalAlpha = 0.78;
    ctx.font = `${Math.round(sisi * 0.020)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(namaTamu, w / 2, h - h * 0.025);
    ctx.globalAlpha = 1;
  }

  ctx.shadowBlur = 0;
}
