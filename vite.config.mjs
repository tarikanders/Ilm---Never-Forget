import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  // En prod, appels backend directs vers Cloud Run pour contourner le plafond de
  // 60 s de Firebase Hosting (les résumés de gros documents dépassent 1 min).
  // En dev, base vide → appels relatifs servis par le même origin (proxy /api).
  const apiBase =
    mode === 'production'
      ? process.env.VITE_API_BASE ?? 'https://ilm-tai4j4j6rq-ew.a.run.app'
      : '';

  return {
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
    },
    plugins: [react(), tailwindcss()],
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
