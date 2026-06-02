import { Service } from "@zenbujs/core/runtime";

/**
 * cm-image-paste service.
 *
 * Single responsibility: inject the content script into every view.
 * The script mounts a hidden React root that handles dbClient
 * mirroring + function-registry registration. Everything else lives
 * in the renderer.
 */
export class CmImagePasteService extends Service.create({
  key: "cm-image-paste",
}) {
  evaluate() {
    this.setup("inject-register", () =>
      this.inject({
        name: "cm-image-paste/bootstrap",
        modulePath: "./src/content/register.tsx",
      }),
    );
  }
}
