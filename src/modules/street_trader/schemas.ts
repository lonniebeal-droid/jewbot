/**
 * JSON Schemas for the Street Trader tools.
 * The M8 registry keeps the module at src/modules/street-trader (id street-trader).
 * This folder is the spec path alias. It does not register a second module.
 */

const question = {
  type: 'string',
  minLength: 1,
  maxLength: 4000,
  description: 'A curriculum question in plain language. Not a ticker and not an order.',
} as const;

export const STREET_TOOL_SCHEMAS = {
  street_ask: {
    type: 'object',
    additionalProperties: false,
    required: ['question'],
    properties: { question },
  },
  street_outline: {
    type: 'object',
    additionalProperties: false,
    properties: {
      topicId: {
        type: 'string',
        description: 'Optional topic id: position-sizing, risk-management, chart-reading, scam-spotting, or trading-routine.',
      },
    },
  },
  street_journal_prompt: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: ['trade', 'session', 'week'],
        description: 'Which journal prompts to return. Omit it for all three.',
      },
    },
  },
  street_drive_log: {
    type: 'object',
    additionalProperties: false,
    required: ['task'],
    properties: {
      task: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
        description: 'One line describing the session. No account numbers, logins, or secrets.',
      },
      kind: {
        type: 'string',
        enum: ['RECEIPT', 'CLAIM', 'STATUS', 'BLOCKER'],
        description: 'Master 3 line kind. Defaults to RECEIPT.',
      },
      section: {
        type: 'string',
        description: 'Curriculum section heading cited for this session.',
      },
    },
  },
} as const;

export type StreetToolName = keyof typeof STREET_TOOL_SCHEMAS;

export function streetToolSchema(name: StreetToolName): Record<string, unknown> {
  return STREET_TOOL_SCHEMAS[name] as unknown as Record<string, unknown>;
}
