// Renders assets/logo.svg into the PNG/ICO icons the app and installers need.
// Run with:  npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'logo.svg'), 'utf8');
const sizes = [1024, 512, 256, 48, 32, 16];

function ico(pngs) {
  // ICO container holding PNG images.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html></html>');
  const out = {};
  for (const size of sizes) {
    const url = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })`);
    out[size] = Buffer.from(url.split(',')[1], 'base64');
  }
  const icoFile = ico([256, 48, 32, 16].map((size) => ({ size, data: out[size] })));
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), out[1024]);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), icoFile);
  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), out[512]);
  fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), icoFile);
  fs.writeFileSync(path.join(root, 'assets', 'tray.png'), out[32]);
  console.log('icons written');
  app.quit();
});
