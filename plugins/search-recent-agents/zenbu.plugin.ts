import { definePlugin } from "@zenbujs/core/config"

export default definePlugin({
  name: "searchRecentAgents",
  services: ["./src/main/services/*.ts"],
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
})
