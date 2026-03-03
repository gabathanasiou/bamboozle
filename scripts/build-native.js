import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import crypto from 'crypto';
import path from 'path';

const ASSETS_DIR = 'assets';
const HASH_FILE = '.assets_hash';
const ICON_PATH = path.join(ASSETS_DIR, 'icon.png');
const SPLASH_PATH = path.join(ASSETS_DIR, 'splash.png');

function getHash(files) {
    const hash = crypto.createHash('md5');
    files.forEach(file => {
        if (existsSync(file)) {
            hash.update(readFileSync(file));
        }
    });
    return hash.digest('hex');
}

console.log('🚀 Starting Smart Build...');

const currentHash = getHash([ICON_PATH, SPLASH_PATH]);
let previousHash = '';

if (existsSync(HASH_FILE)) {
    previousHash = readFileSync(HASH_FILE, 'utf8');
}

if (currentHash !== previousHash) {
    console.log('✨ Assets changed! Generating native graphics...');
    try {
        execSync('npx @capacitor/assets generate --android', { stdio: 'inherit' });
        writeFileSync(HASH_FILE, currentHash);
        console.log('✅ Native graphics updated.');
    } catch (error) {
        console.error('❌ Failed to generate assets:', error.message);
        process.exit(1);
    }
} else {
    console.log('⏩ Assets unchanged. Skipping native graphics generation.');
}

console.log('📦 Building web application...');
execSync('npm run build', { stdio: 'inherit' });

console.log('📲 Syncing with Android...');
execSync('npx cap sync android', { stdio: 'inherit' });

console.log('🏁 Build complete!');
