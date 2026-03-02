import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    root: __dirname,
    plugins: [
        react(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            // Map @ to the main project root
            '@': path.resolve(__dirname, '../../'),
        },
    },
    server: {
        port: 3001,
        host: true,
        fs: {
            // Allow Vite to serve files from the main project folder
            allow: [path.resolve(__dirname, '../../')]
        }
    },
    build: {
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: true,
    }
});
