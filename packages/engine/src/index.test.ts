import { describe, expect, it } from 'vitest';

import { ENGINE_VERSION, RULES_EDITION } from './index';

describe('engine package boundary', () => {
  it('exports its version and rules edition', () => {
    expect(ENGINE_VERSION).toBe('0.0.0');
    expect(RULES_EDITION).toBe('v14');
  });
});
