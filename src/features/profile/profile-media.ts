export async function profileImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择一张图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('图片过大，请选择 20 MB 以内的图片');
  const input = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('图片读取失败'));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('图片处理失败'));
        return;
      }
      const side = Math.min(image.width, image.height);
      context.drawImage(
        image,
        (image.width - side) / 2,
        (image.height - side) / 2,
        side,
        side,
        0,
        0,
        400,
        400,
      );
      resolve(canvas.toDataURL('image/jpeg', 0.84));
    };
    image.onerror = () => reject(new Error('无法打开这张图片，请尝试其他图片'));
    image.src = input;
  });
}
