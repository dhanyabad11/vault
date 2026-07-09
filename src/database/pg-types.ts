import { types } from 'pg';

// By default node-postgres returns BIGINT (int8, oid 20) as a string to avoid
// precision loss. Our money values fit comfortably within Number.MAX_SAFE_INTEGER
// for this project, so we parse them to `number` for ergonomic arithmetic.
//
// KNOWN LIMITATION: a real ledger holding > 2^53 minor units would need BigInt or
// a decimal library. Documented as a deliberate Phase 1 shortcut.
types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10));
