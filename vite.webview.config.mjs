import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [svelte()],
	build: {
		target: 'es2022',
		outDir: 'dist/webview',
		emptyOutDir: true,
		minify: mode === 'production',
		modulePreload: false,
		codeSplitting: false,
		rollupOptions: {
			input: resolve('src/webview/app/main.ts'),
			output: {
				entryFileNames: 'index.js',
				assetFileNames: assetInfo => assetInfo.name?.endsWith('.css') ? 'index.css' : 'assets/[name]-[hash][extname]',
			},
		},
	},
}));