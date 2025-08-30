/**
 * Dropcaster Configuration File
 * 
 * This file configures your dropcaster gallery.
 * Rename this file to `dropcaster.config.js` to use it.
 */

export default {
  // Gallery title (appears in browser tab and PWA name)
  title: 'My Sketch Gallery',
  
  // Gallery description
  description: 'A collection of creative coding sketches',
  
  // Theme color (used by PWA and browser)
  theme_color: '#000000',
  
  // Background color (used when PWA is loading)
  background_color: '#ffffff',
  
  // Display mode (standalone, fullscreen, minimal-ui, browser)
  display: 'standalone',
  
  // Start URL when PWA launches
  start_url: '/',
  
  // Enable offline mode (caches resources for offline viewing)
  offline_mode: true,
  
  // Cache strategy ('network-first' or 'cache-first')
  // network-first: Try network first, fallback to cache
  // cache-first: Use cache first, update from network
  cache_strategy: 'network-first',
  
  // Custom icon path (relative to public directory)
  // If not specified, uses default icon
  // icon: '/icon.png',
  
  // Base URL for deployment (e.g., '/my-gallery/' for GitHub Pages)
  // base: '/',
  
  // Additional metadata
  author: 'Your Name',
  keywords: 'creative coding, p5js, generative art',
  
  // Social media metadata (optional)
  social: {
    twitter: '@yourusername',
    github: 'yourusername'
  }
};