// The live database checks saves with firestore.rules, which the tests' LocalStore doesn't. FirebaseStore adds the
// doc `id` to every save, so a rule that lists the allowed fields must allow `id` too, or every save is refused.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');

describe('firestore.rules for orderAmounts', () => {
  it('allows every field the manager app saves, including the id the store adds', () => {
    const block = /match \/orderAmounts\/\{id\} \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? '';
    const allowed = /hasOnly\(\[([^\]]*)\]\)/.exec(block)?.[1].split(',').map((s) => s.trim().replace(/'/g, '')) ?? [];
    for (const field of ['amount', 'paid', 'updatedAt', 'id']) expect(allowed).toContain(field);
  });
});
