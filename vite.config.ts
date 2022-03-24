import { fileURLToPath, URL } from 'url'

import { build, defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import viteCompression from 'vite-plugin-compression';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(), viteCompression(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    minify: true,
    target: "esnext",
		// assetsInlineLimit: 100000000,
		// chunkSizeWarningLimit: 100000000,
		cssCodeSplit: false,
		brotliSize: false,
		// rollupOptions: {
		// 	inlineDynamicImports: true,
		// 	output: {
		// 		manualChunks: () => "bundle.js",
		// 	},
		// },
  },
  optimizeDeps: {
    // esbuildOptions: {
    //   keepNames: true,
    // }
    // exclude: ['zksync-web3', 'ethers']
  }
})