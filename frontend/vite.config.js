import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the built site work from any folder, e.g. https://you.github.io/book-marathon/
export default defineConfig({
  plugins: [react()],
  base: './',
});
