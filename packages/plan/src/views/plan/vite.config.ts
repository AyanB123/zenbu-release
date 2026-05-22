import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Plan-view vite config. Pulls in tailwindcss + the react plugin so the
 * standalone iframe view picks up Streamdown's utility classes (flex /
 * gap / bg-card etc.) and shadcn-style design tokens defined in
 * `./styles.css`. Zenbu's framework plugins (advice prelude, advice
 * transform) are appended automatically by the reloader on top of the
 * ones returned here.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
