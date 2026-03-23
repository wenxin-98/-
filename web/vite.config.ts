import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9527',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-recharts': ['recharts'],
          'vendor-misc': ['axios', 'zustand', 'react-hot-toast'],
        },
      },
    },
  },
});
