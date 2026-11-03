// Copies the unchanged v1 site (legacy-v1/) into dist/v1/ after the Vite build.
import { cpSync, existsSync, rmSync } from 'node:fs';

const src = new URL('../legacy-v1/', import.meta.url);
const dest = new URL('../dist/v1/', import.meta.url);
if (!existsSync(new URL('index.html', src))) { console.error('legacy-v1/index.html not found'); process.exit(1); }
if (!existsSync(new URL('../dist/index.html', import.meta.url))) { console.error('dist/index.html not found: run vite build first'); process.exit(1); }
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log('Copied legacy-v1/ → dist/v1/');
