import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api is proxied to the local terminal bridge (`npm run bridge`) so the
// browser build of InfinityCoder can execute REAL shell commands.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:5299", changeOrigin: true }
    }
  }
});
