import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The Flask app owns port 5000. Vite deliberately stays on 5173 so both can
// run side by side during development.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Forwarded server-side to Flask, so the browser only ever talks to
      // :5173 -- requests are same-origin from its point of view. That
      // means the Flask session cookie (which holds game state) is set
      // for this origin with no CORS or cross-site cookie configuration
      // needed at all.
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
