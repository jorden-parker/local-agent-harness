import type { ConfirmationChoice } from "../run/runState.js";
import type { ToolCall } from "../tools/toolCall.js";

export interface Confirmer {
  confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice>;
}
