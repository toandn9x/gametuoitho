/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        arcade: {
          950: '#060609',
          900: '#0a0a0f',
          800: '#13131c',
          700: '#1d1d2d',
          600: '#2c2c42',
        },
        neon: {
          cyan: '#00ffff',
          pink: '#ff007f',
          yellow: '#ffe600',
          green: '#00ff66',
          purple: '#9d4edd',
        },
        nokia: {
          screen: '#879b6f',
          pixel: '#2b3a1d',
          bezel: '#3a444c',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Courier New', 'Courier', 'monospace'],
      },
      boxShadow: {
        'neon-cyan': '0 0 15px rgba(0, 255, 255, 0.4)',
        'neon-pink': '0 0 15px rgba(255, 0, 127, 0.4)',
        'neon-yellow': '0 0 15px rgba(255, 230, 0, 0.4)',
        'arcade-panel': 'inset 0 0 20px rgba(0,0,0,0.8), 0 0 10px rgba(0,255,255,0.2)',
      },
    },
  },
  plugins: [],
};
