import { Service } from "@zenbujs/core/runtime"

/**
 * Registers the component-mode `"tutorial"` view — the guided
 * onboarding tour, default tab of the playground workspace and
 * re-openable from the command palette.
 */
export class TutorialViewService extends Service.create({
  key: "tutorialView",
}) {
  evaluate() {
    this.setup("inject-tutorial-view", () =>
      this.inject({
        name: "tutorial",
        modulePath: "./src/renderer/views/tutorial/tutorial-app.tsx",
        meta: { kind: "view", label: "Tutorial" },
      }),
    )
  }
}
