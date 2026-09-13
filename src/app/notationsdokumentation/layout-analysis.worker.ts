/// <reference lib="webworker" />

export interface LayoutBlock {
  id: string;
  kind: 'staff' | 'text' | 'initial';
  label: string;
  rect: { x: number; y: number; w: number; h: number }; // Percentage 0..100
  points: string; // "x1,y1 x2,y2 x3,y3 x4,y4"
}

export interface AnalysisRequest {
  canvasIndex: number;
  imageUrl: string;
  width: number;
  height: number;
  imageData: ImageData;
}

export interface AnalysisResponse {
  canvasIndex: number;
  blocks: LayoutBlock[];
}

addEventListener('message', ({ data }: { data: AnalysisRequest }) => {
  if (!data || !data.imageData) {
    postMessage({ canvasIndex: data?.canvasIndex ?? 0, blocks: [] });
    return;
  }

  const { canvasIndex, width, height, imageData } = data;
  const blocks = analyzeLayout(imageData, width, height);
  postMessage({ canvasIndex, blocks } as AnalysisResponse);
});

function analyzeLayout(imageData: ImageData, width: number, height: number): LayoutBlock[] {
  const pixels = imageData.data;
  const numPixels = width * height;
  const gray = new Uint8Array(numPixels);

  // 1. Grayscale Conversion
  for (let i = 0; i < numPixels; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // 2. Otsu Binarization Threshold
  const threshold = otsuThreshold(gray);
  const binary = new Uint8Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    binary[i] = gray[i] < threshold ? 1 : 0; // 1 = Dark pixel (ink)
  }

  // 3. Horizontal Projection Profile (Row-wise sum of dark pixels)
  const rowSums = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      sum += binary[rowOffset + x];
    }
    rowSums[y] = sum;
  }

  // 4. Smooth profile & detect horizontal bands
  const smoothed = smoothArray(rowSums, 5);
  const avgDensity = rowSums.reduce((a, b) => a + b, 0) / height;
  const minDensity = avgDensity * 0.35;

  const bands: { startY: number; endY: number; peakDensity: number }[] = [];
  let inBand = false;
  let bandStart = 0;
  let maxD = 0;

  for (let y = 0; y < height; y++) {
    const val = smoothed[y];
    if (val > minDensity) {
      if (!inBand) {
        inBand = true;
        bandStart = y;
        maxD = val;
      } else {
        if (val > maxD) maxD = val;
      }
    } else {
      if (inBand) {
        inBand = false;
        if (y - bandStart > 12) { // Minimum height for a band
          bands.push({ startY: bandStart, endY: y, peakDensity: maxD });
        }
      }
    }
  }
  if (inBand && height - bandStart > 12) {
    bands.push({ startY: bandStart, endY: height, peakDensity: maxD });
  }

  // 5. Classify & refine bands into Staff Regions vs Text Regions
  const blocks: LayoutBlock[] = [];
  let staffCounter = 1;
  let textCounter = 1;

  for (let idx = 0; idx < bands.length; idx++) {
    const b = bands[idx];
    const bandH = b.endY - b.startY;

    // Analyze internal periodicity (sub-peaks) inside band to distinguish Staff (4/5 lines) from Text
    const subProfile = rowSums.subarray(b.startY, b.endY);
    const subPeaks = countPeaks(subProfile);

    // Vertical bounding bounds (X-min & X-max)
    let minX = width;
    let maxX = 0;
    for (let y = b.startY; y < b.endY; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        if (binary[rowOffset + x] === 1) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }

    if (minX >= maxX) {
      minX = Math.round(width * 0.1);
      maxX = Math.round(width * 0.9);
    }

    // Add padding
    const padX = Math.round(width * 0.015);
    const padY = Math.round(height * 0.008);
    const clampX1 = Math.max(0, minX - padX);
    const clampX2 = Math.min(width, maxX + padX);
    const clampY1 = Math.max(0, b.startY - padY);
    const clampY2 = Math.min(height, b.endY + padY);

    // Percentages
    const pctX = (clampX1 / width) * 100;
    const pctY = (clampY1 / height) * 100;
    const pctW = ((clampX2 - clampX1) / width) * 100;
    const pctH = ((clampY2 - clampY1) / height) * 100;

    const f = (v: number) => v.toFixed(2);
    const x1 = clampX1 / width * 100;
    const y1 = clampY1 / height * 100;
    const x2 = clampX2 / width * 100;
    const y2 = clampY2 / height * 100;
    const pointsStr = `${f(x1)},${f(y1)} ${f(x2)},${f(y1)} ${f(x2)},${f(y2)} ${f(x1)},${f(y2)}`;

    // Determine region kind: Staff staves typically have 3 to 7 periodic line peaks
    const isStaff = subPeaks >= 3 && subPeaks <= 8 && bandH > 20;
    const kind: 'staff' | 'text' = isStaff ? 'staff' : 'text';
    const label = isStaff ? `Staff ${staffCounter++}` : `Text ${textCounter++}`;

    blocks.push({
      id: `auto_${idx}_${Date.now()}`,
      kind,
      label,
      rect: { x: pctX, y: pctY, w: pctW, h: pctH },
      points: pointsStr
    });
  }

  return blocks;
}

function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVar = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);

    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

function smoothArray(arr: Int32Array, windowSize: number): Float32Array {
  const result = new Float32Array(arr.length);
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < arr.length) {
        sum += arr[j];
        count++;
      }
    }
    result[i] = sum / count;
  }
  return result;
}

function countPeaks(arr: Int32Array): number {
  let peaks = 0;
  const avg = arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > avg && arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) {
      peaks++;
    }
  }
  return peaks;
}
