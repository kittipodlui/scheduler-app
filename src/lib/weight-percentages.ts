import type { SubjectPreference } from './subjects';

export function getNormalizedWeightPercentages(
  subjects: readonly Pick<SubjectPreference, 'weight'>[],
): number[] {
  if (subjects.length === 0) return [];

  const totalWeight = subjects.reduce((total, subject) => total + subject.weight, 0);
  const exactShares = subjects.map((subject) => (subject.weight / totalWeight) * 100);
  const shares = exactShares.map(Math.floor);
  const remainingPoints = 100 - shares.reduce((total, share) => total + share, 0);
  const remainderOrder = exactShares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((left, right) => right.remainder - left.remainder);

  for (let index = 0; index < remainingPoints; index += 1) {
    shares[remainderOrder[index].index] += 1;
  }
  return shares;
}