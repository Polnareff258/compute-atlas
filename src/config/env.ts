const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export function getServerConfig() {
  return {
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
    agentRequestTimeoutMs: 15_000,
    maxAgentMessageLength: 500,
  } as const;
}
