function unpackRow(input, output) {
  let source = 0;
  let target = 0;
  while (source < input.length) {
    const control = input[source++];
    if (control === 128) continue;
    const count = control < 128 ? control + 1 : 257 - control;
    const bytes = control < 128 ? count : 1;
    if (target + count > output.length || source + bytes > input.length) {
      throw new Error('Повреждена строка PSD.');
    }
    if (control < 128) output.set(input.subarray(source, source + count), target);
    else output.fill(input[source], target, target + count);
    source += bytes;
    target += count;
  }
  if (target !== output.length) throw new Error('Неполная строка PSD.');
}

export async function readPsdComposite(file) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.getUint32(0) !== 0x38425053 || view.getUint16(4) !== 1) {
    throw new Error('Выбери файл PSD.');
  }
  const channels = view.getUint16(12);
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  if (view.getUint16(22) !== 8 || view.getUint16(24) !== 3 || channels < 3 || channels > 56) {
    throw new Error('Для PSD выбери в Photoshop режим RGB, 8 бит/канал.');
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) {
    throw new Error('Размер текстуры PSD превышает 16 Мп или 8192 пикселя по стороне.');
  }
  const pixels = width * height;
  let offset = 26;
  for (let section = 0; section < 3; section++) offset += 4 + view.getUint32(offset);
  if (offset + 2 >= bytes.length) {
    throw new Error('Пересохрани PSD с включённой максимальной совместимостью.');
  }
  const compression = view.getUint16(offset);
  offset += 2;
  const colorBytes = pixels * 3;
  let planes;
  if (compression === 0) {
    planes = bytes.subarray(offset, offset + colorBytes);
  } else if (compression === 1) {
    const table = offset;
    offset += height * channels * 2;
    planes = new Uint8Array(colorBytes);
    for (let row = 0; row < height * 3; row++) {
      const length = view.getUint16(table + row * 2);
      unpackRow(bytes.subarray(offset, offset + length), planes.subarray(row * width, (row + 1) * width));
      offset += length;
    }
  } else if (compression === 2 || compression === 3) {
    const stream = file.slice(offset).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader();
    planes = new Uint8Array(colorBytes);
    let copied = 0;
    try {
      while (copied < colorBytes) {
        const { value, done } = await reader.read();
        if (done) throw new Error('Неполное сводное изображение PSD.');
        const chunk = value.subarray(0, colorBytes - copied);
        planes.set(chunk, copied);
        copied += chunk.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (compression === 3) {
      for (let row = 0; row < colorBytes; row += width) {
        for (let x = 1; x < width; x++) planes[row + x] += planes[row + x - 1];
      }
    }
  } else {
    throw new Error('Неподдерживаемое сжатие PSD.');
  }
  if (planes.length < colorBytes) throw new Error('Неполное сводное изображение PSD.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const index = pixel * 4;
    image.data[index] = planes[pixel];
    image.data[index + 1] = planes[pixels + pixel];
    image.data[index + 2] = planes[2 * pixels + pixel];
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
