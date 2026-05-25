import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/zmk-module-mouse-gesture-rpc/",
  server: { port: 5173 },
});
