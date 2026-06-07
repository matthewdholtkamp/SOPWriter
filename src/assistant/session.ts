import type { SopSpec } from "../model/sopSpec";
import type { ComplianceItem } from "../validation/validate";
import { appliedFieldsFromResponse, applyAssistantPatch } from "./apply";
import { requestSopAssistant } from "./client";
import type { AssistantMessage, AssistantResponse } from "./schema";

export function createAssistantMessage(
  role: AssistantMessage["role"],
  text: string,
  update: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    ...update
  };
}

export async function runSopAssistant({
  messages,
  spec,
  userText,
  validationItems
}: {
  messages: AssistantMessage[];
  spec: SopSpec;
  userText: string;
  validationItems: ComplianceItem[];
}): Promise<{
  appliedFields: string[];
  nextSpec: SopSpec | null;
  response: AssistantResponse;
}> {
  const response = await requestSopAssistant({
    messages,
    spec,
    userText,
    validationItems
  });
  const appliedFields =
    response.action === "applyPatch" && response.specPatch
      ? appliedFieldsFromResponse(response)
      : [];
  const nextSpec =
    response.action === "applyPatch" && response.specPatch
      ? applyAssistantPatch(spec, response.specPatch)
      : null;

  return { appliedFields, nextSpec, response };
}
