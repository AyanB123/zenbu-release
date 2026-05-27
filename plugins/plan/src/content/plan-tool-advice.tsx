import type { ComponentType } from "react";
import { useRpc } from "@zenbujs/core/react";

/**
 * Around-advice on the host's `ToolCall` chat-message component
 * (declared by `PlanService.evaluate()` via `this.advise(...)`).
 *
 * Calling convention: zenbu's advice runtime calls around-advice as
 *   `aroundFn(next, ...originalArgs)`
 * where `next` is the original component (or the next around in the
 * chain). For a React component the original args are just the
 * props object, so the signature here is `(Original, props)`.
 *
 * Behavior:
 *  - Non-plan tool calls: forward to the original component.
 *  - Plan tool calls that haven't finished streaming yet (no
 *    `details` in `rawOutput`): also forward to the original
 *    component (the default rendering knows how to show a spinner).
 *  - Plan tool calls with a completed `details` payload: render
 *    the `PlanCard` with an "Open Plan" button.
 *
 * The "Open Plan" click round-trips through
 * `rpc.plan.plan.openInActivePane`. That fires the host's generic
 * `openViewInActivePane` event, which the host shell catches and
 * routes via `openViewBySourceInRoot` to the `plan` view registered
 * by this plugin's main-process service. The host has no
 * `plan`-specific code on either side of that edge.
 */

// Mirror of the host's `ToolCallProps` shape. Duplicated here
// instead of imported so this plugin doesn't reach into the host's
// source tree. The advice runtime hands us whatever the host's
// component receives.
type ToolCallShape = {
  toolCallId: string;
  title?: string;
  subtitle?: string;
  kind?: string;
  status?: "pending" | "running" | "completed" | "failed";
  toolName?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
};

type PlanDetails = {
  title?: unknown;
  markdown?: unknown;
};

function readPlanDetails(rawOutput: unknown): {
  title: string;
  markdown: string;
} | null {
  if (!rawOutput || typeof rawOutput !== "object") return null;
  const details = (rawOutput as { details?: PlanDetails }).details;
  if (!details || typeof details !== "object") return null;
  const title = typeof details.title === "string" ? details.title : null;
  const markdown =
    typeof details.markdown === "string" ? details.markdown : null;
  if (title == null || markdown == null) return null;
  return { title, markdown };
}

// Fires once per advice module load so we can confirm the advice file
// actually evaluated in the renderer (vs. being silently dropped by
// the vite plugin / advice prelude).
console.log("[plan-advice] module loaded");

export function PlanToolAdvice(
  Original: ComponentType<ToolCallShape>,
  props: ToolCallShape,
) {
  // Always log so we can see whether the advice runtime is even
  // calling us, regardless of whether the tool is `plan`. Once the
  // happy-path is verified end-to-end, the call-site logs can be
  // narrowed to just `toolName === "plan"`.


  if (props.toolName !== "plan") {
    return <Original {...props} />;
  }

  // While the tool is still streaming its arguments the LLM hasn't
  // committed to a result yet — fall back to the default rendering
  // (which knows how to show a spinner).
  const plan =
    props.status === "completed" ? readPlanDetails(props.rawOutput) : null;
  if (!plan) {
    
    return <Original {...props} />;
  }

  console.log("[plan-advice] rendering PlanCard", {
    title: plan.title,
    markdownLength: plan.markdown.length,
  });
  return (
    <PlanCard
      toolCallId={props.toolCallId}
      title={plan.title}
      markdown={plan.markdown}
    />
  );
}

function PlanCard({
  toolCallId,
  title,
  markdown,
}: {
  toolCallId: string;
  title: string;
  markdown: string;
}) {
  const rpc = useRpc();

  // First few lines of the body as a teaser. Truncating in CSS
  // instead would require pulling tailwind into this advice module,
  // which we want to stay independent of the host's design system —
  // keep it text-only.
  const preview = markdown
    .split("\n")
    .filter(line => line.trim().length > 0)
    .slice(0, 3)
    .join(" ")
    .slice(0, 180);

  return (
    <div className="px-3">
      <div
        style={{
          borderRadius: 8,
          padding: "10px 12px",
          background: "var(--color-muted, rgba(127,127,127,0.08))",
          border: "1px solid var(--color-border, rgba(127,127,127,0.18))",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                opacity: 0.55,
              }}
            >
              Plan
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              // `rpc.<pluginName>.<serviceKey>.<method>`. Both the
              // plugin and the service inside it are named `plan`.
              void rpc.plan.plan.openInActivePane({
                toolCallId,
                title,
                markdown,
              });
            }}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--color-border, rgba(127,127,127,0.3))",
              background: "transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Open Plan
          </button>
        </div>
        {preview && (
          <div
            style={{
              fontSize: 12,
              opacity: 0.7,
              lineHeight: 1.45,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {preview}
          </div>
        )}
      </div>
    </div>
  );
}
