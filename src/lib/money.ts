export function parseMoneyToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function amountDueCents(baseFeeCents: number, discountCents: number): number {
  if (!Number.isInteger(baseFeeCents) || !Number.isInteger(discountCents) || baseFeeCents < 0 || discountCents < 0) {
    throw new RangeError('Amounts must be nonnegative integer cents.');
  }
  if (discountCents > baseFeeCents) throw new RangeError('Discount cannot exceed the entry fee.');
  return baseFeeCents - discountCents;
}

export function paymentDraft(input: {
  baseFeeCents: number;
  paid: boolean;
  method: 'cash' | 'card' | null;
  amountPaidCents: number;
  discountCents: number;
  note: string;
}): { paid: boolean; paymentMethod: 'cash' | 'card' | null; amountPaidCents: number; discountCents: number; paymentNote: string | null } {
  const due = amountDueCents(input.baseFeeCents, input.discountCents);
  if (!input.paid) return { paid: false, paymentMethod: null, amountPaidCents: 0, discountCents: input.discountCents, paymentNote: input.note.trim() || null };
  if (!Number.isInteger(input.amountPaidCents) || input.amountPaidCents < 0) throw new RangeError('Payment must be nonnegative cents.');
  if (input.amountPaidCents > 0 && !input.method) throw new RangeError('Choose cash or card for a payment above $0.');
  if (input.amountPaidCents !== due && input.amountPaidCents > 0 && !input.note.trim()) {
    // The UI may confirm an adjustment without a note; this function records only the exact amount received.
  }
  return {
    paid: true,
    paymentMethod: input.amountPaidCents === 0 ? null : input.method,
    amountPaidCents: input.amountPaidCents,
    discountCents: input.discountCents,
    paymentNote: input.note.trim() || null,
  };
}
