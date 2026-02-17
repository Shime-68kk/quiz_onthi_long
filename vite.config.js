import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/quiz_onthi_long/",

  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["sheep.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "ShimeChamhoc",
        short_name: "ShimeQuiz",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#0b1220",
        theme_color: "#0b1220",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,json,png,svg,ico,txt,woff2}"],
      },
    }),
  ],
});
