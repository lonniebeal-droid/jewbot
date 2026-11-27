/**
 * Spec path for Street Trader (`modules/street_trader`).
 * The implementation stays in `src/modules/street-trader` so the M8 id
 * `street-trader` still matches that directory. This folder re-exports it.
 * It has no manifest, so discovery does not register a second copy.
 */
export {
  STREET_TOOL_SCHEMAS,
  streetToolSchema,
  type StreetToolName,
} from './schemas';
export * from '../street-trader';
