import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Read as text: jsdom parses no stylesheet, so the declaration is otherwise unobservable.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8');

describe('app shell height chain', () => {
  it('sizes html, body and #app from the initial containing block, not a viewport unit', () => {
    const rule = /html,\s*body,\s*#app\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('height: 100%');
    expect(rule![1]).not.toMatch(/\d\s*(dvh|svh|lvh|vh)\b/);
  });
});
