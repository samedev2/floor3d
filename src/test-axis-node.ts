// ============================================
// TEST NODE: axis-line parser na imagem anexo2
// Usa jimp para carregar e simula o algoritmo
// ============================================
const { Jimp } = require('jimp');

async function testAxisLineParser(imagePath: string) {
  console.log(`\n=== Testando: ${imagePath} ===\n`);

  const image = await Jimp.read(imagePath);
  const W = image.bitmap.width;
  const H = image.bitmap.height;
  console.log(`Dimensões: ${W}x${H}`);

  // Extrai pixels RGBA
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const pixel = image.getPixelColor(x, y);
      data[idx] = (pixel >> 24) & 0xff;
      data[idx + 1] = (pixel >> 16) & 0xff;
      data[idx + 2] = (pixel >> 8) & 0xff;
      data[idx + 3] = pixel & 0xff;
    }
  }

  // 1. OTSU
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.floor((data[i] + data[i + 1] + data[i + 2]) / 3);
    hist[gray]++;
  }
  const total = W * H;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  console.log(`OTSU threshold: ${threshold}`);

  // 2. Máscara binária
  const mask = new Uint8Array(W * H);
  let blackCount = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    mask[j] = gray < threshold ? 1 : 0;
    if (mask[j]) blackCount++;
  }
  console.log(`Pixels pretos: ${blackCount} (${((blackCount / (W * H)) * 100).toFixed(1)}%)`);

  // 3. Parâmetros
  const yStart = Math.floor(H * 0.05);
  const yEnd = H - Math.floor(H * 0.05);
  const xStart = Math.floor(W * 0.05);
  const xEnd = W - Math.floor(W * 0.05);
  const minRunLength = (xEnd - xStart) * 0.18;
  const minWallLength = Math.max(30, Math.max(W, H) * 0.10);

  console.log(`\nMin extent: ${minRunLength.toFixed(0)}px`);
  console.log(`Min wall length: ${minWallLength.toFixed(0)}px`);

  // 4. Encontra paredes horizontais (por extensão total)
  const hWalls = [];
  for (let y = yStart; y < yEnd; y++) {
    let firstX = -1;
    let lastX = -1;
    let count = 0;
    for (let x = xStart; x < xEnd; x++) {
      if (mask[y * W + x]) {
        if (firstX === -1) firstX = x;
        lastX = x;
        count++;
      }
    }
    if (firstX === -1) continue;
    const extent = lastX - firstX;
    if (extent >= minRunLength && count >= extent * 0.4) {
      hWalls.push({ y, x1: firstX, x2: lastX, length: extent, count });
    }
  }

  // 5. Encontra paredes verticais
  const vWalls = [];
  for (let x = xStart; x < xEnd; x++) {
    let firstY = -1;
    let lastY = -1;
    let count = 0;
    for (let y = yStart; y < yEnd; y++) {
      if (mask[y * W + x]) {
        if (firstY === -1) firstY = y;
        lastY = y;
        count++;
      }
    }
    if (firstY === -1) continue;
    const extent = lastY - firstY;
    if (extent >= minRunLength && count >= extent * 0.4) {
      vWalls.push({ x, y1: firstY, y2: lastY, length: extent, count });
    }
  }

  console.log(`\nCandidatos horizontais: ${hWalls.length}`);
  console.log(`Candidatos verticais: ${vWalls.length}`);

  // 6. Mescla paralelos adjacentes
  const tol = Math.min(W, H) * 0.04;
  const sortedH = [...hWalls].sort((a, b) => a.y - b.y);
  const mergedH = [];
  for (const w of sortedH) {
    if (mergedH.length > 0 && Math.abs(mergedH[mergedH.length - 1].y - w.y) <= tol) {
      const last = mergedH[mergedH.length - 1];
      const newX1 = Math.min(last.x1, w.x1);
      const newX2 = Math.max(last.x2, w.x2);
      const newY = Math.round((last.y + w.y) / 2);
      last.y = newY;
      last.x1 = newX1;
      last.x2 = newX2;
      last.length = newX2 - newX1;
    } else {
      mergedH.push({ ...w });
    }
  }
  const finalH = mergedH.filter(w => w.length >= minWallLength);

  const sortedV = [...vWalls].sort((a, b) => a.x - b.x);
  const mergedV = [];
  for (const w of sortedV) {
    if (mergedV.length > 0 && Math.abs(mergedV[mergedV.length - 1].x - w.x) <= tol) {
      const last = mergedV[mergedV.length - 1];
      const newY1 = Math.min(last.y1, w.y1);
      const newY2 = Math.max(last.y2, w.y2);
      const newX = Math.round((last.x + w.x) / 2);
      last.x = newX;
      last.y1 = newY1;
      last.y2 = newY2;
      last.length = newY2 - newY1;
    } else {
      mergedV.push({ ...w });
    }
  }
  const finalV = mergedV.filter(w => w.length >= minWallLength);

  console.log(`\n=== RESULTADO ===`);
  console.log(`Paredes horizontais (após merge): ${finalH.length}`);
  for (const w of finalH) {
    console.log(`  H: y=${w.y}, x=${w.x1}→${w.x2}, length=${w.length}px`);
  }
  console.log(`\nParedes verticais (após merge): ${finalV.length}`);
  for (const w of finalV) {
    console.log(`  V: x=${w.x}, y=${w.y1}→${w.y2}, length=${w.length}px`);
  }
  console.log(`\nTotal: ${finalH.length + finalV.length} paredes`);
  console.log(`Tamanho da imagem: ${W}x${H}`);
}

const imagePath = process.argv[2] || 'C:\\Users\\Administrador\\.minimax\\v2\\assets\\2026\\08\\27\\23-17-43-739-asset_20260827-231743-739_95ee80d18bf7_00f6f6c4-409014.jpg';
testAxisLineParser(imagePath).catch(console.error);
