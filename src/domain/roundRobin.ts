export interface RoundRobinFixture {
  a: string;
  b: string;
  round: number;
  sequence: number;
}

export function roundRobin(entryIds: readonly string[]): RoundRobinFixture[] {
  if (new Set(entryIds).size !== entryIds.length) throw new RangeError('Entrant IDs must be unique.');
  if (entryIds.length < 2) return [];

  const rotation: Array<string | null> = [...entryIds];
  if (rotation.length % 2 === 1) rotation.push(null);
  const rounds = rotation.length - 1;
  const fixtures: RoundRobinFixture[] = [];

  for (let round = 0; round < rounds; round += 1) {
    let sequence = 0;
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const a = rotation[index];
      const b = rotation[rotation.length - index - 1];
      if (a !== null && b !== null) {
        fixtures.push({ a, b, round: round + 1, sequence: ++sequence });
      }
    }
    const fixed = rotation[0];
    const rotating = rotation.slice(1);
    rotating.unshift(rotating.pop() ?? null);
    rotation.splice(0, rotation.length, fixed, ...rotating);
  }

  return fixtures;
}
