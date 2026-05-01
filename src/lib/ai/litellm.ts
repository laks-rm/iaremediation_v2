type LiteLlmModelPurpose = "ingestion" | "analysis" | "insights";

const DEFAULT_LITELLM_BASE_URL = "https://api.litellm.ai/v1";
const DEFAULT_LITELLM_MODEL = "gpt-4o-mini";

export function getLiteLlmChatCompletionsUrl() {
  if (process.env.LITELLM_API_URL) {
    return process.env.LITELLM_API_URL;
  }

  const baseUrl = process.env.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

export function getLiteLlmModel(purpose: LiteLlmModelPurpose) {
  if (purpose === "ingestion") {
    return (
      process.env.LITELLM_MODEL_INGESTION ??
      process.env.LITELLM_EXTRACTION_MODEL ??
      process.env.LITELLM_MODEL ??
      DEFAULT_LITELLM_MODEL
    );
  }

  if (purpose === "insights") {
    return (
      process.env.LITELLM_MODEL_INSIGHTS ??
      process.env.LITELLM_MODEL ??
      DEFAULT_LITELLM_MODEL
    );
  }

  return (
    process.env.LITELLM_MODEL_ANALYSIS ??
    process.env.LITELLM_MODEL ??
    DEFAULT_LITELLM_MODEL
  );
}
