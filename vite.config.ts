import { defineConfig } from "vite";
import { glazeRecordPlugin } from "./server/recordPlugin.mjs";

export default defineConfig({
  plugins: [glazeRecordPlugin()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    open: true,
  },
  optimizeDeps: {
    include: [
      "webgazer",
      "@tensorflow/tfjs",
      "@tensorflow-models/face-landmarks-detection",
      "localforage",
      "regression",
    ],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
