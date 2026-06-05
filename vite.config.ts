import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/SOPWriter/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["assets/seals/*.png", "assets/seals/*.svg"],
      manifest: {
        name: "SOP Writer",
        short_name: "SOP Writer",
        description: "Local-first GLWCH publication writer in DHA format.",
        theme_color: "#1f5e4f",
        background_color: "#eef2f1",
        display: "standalone",
        start_url: "/SOPWriter/",
        icons: [
          {
            src: "assets/icons/icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml"
          },
          {
            src: "assets/icons/icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml"
          }
        ]
      },
      workbox: {
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,ico,json}"]
      }
    })
  ]
});
