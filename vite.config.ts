/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
