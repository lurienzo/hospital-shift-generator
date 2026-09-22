import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // L'app è pubblicata in una sottocartella del sito, quindi gli asset vanno
  // referenziati con un percorso relativo a essa.
  base: '/hospital-shift-generator/',
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
