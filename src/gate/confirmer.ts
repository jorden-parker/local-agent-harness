import type { ConfirmationChoice } from "../run/run-state.js";
import type { ToolCall } from "../tools/tool-call.js";

export interface Confirmer {
  confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice>;
}
