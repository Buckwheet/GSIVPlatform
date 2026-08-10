import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: /api → the v2 backend (default :3102; override with BACKEND_PORT).
const backendPort = process.env.BACKEND_PORT || "3102";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
