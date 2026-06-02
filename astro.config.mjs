// @ts-check
import { defineConfig } from 'astro/config';

// Served from GitHub Pages at https://willschenk.github.io/nerc-grid-map/.
// The map client builds its data URLs from import.meta.env.BASE_URL, so the base
// path below is the only place hosting location is configured.
export default defineConfig({
  site: 'https://willschenk.github.io',
  base: import.meta.env.PROD ? '/nerc-grid-map/' : '/',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
