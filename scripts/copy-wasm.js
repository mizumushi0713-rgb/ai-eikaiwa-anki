// postinstall: copy sql.js WASM to public directory for server-side access
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const destDir = path.join(__dirname, '..', 'public');
const dest = path.join(destDir, 'sql-wasm.wasm');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  console.log('✓ sql-wasm.wasm copied to public/');
} else {
  console.warn('⚠ sql.js WASM not found, skipping copy');
}
