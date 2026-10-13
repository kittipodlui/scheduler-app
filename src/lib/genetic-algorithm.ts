import type { SubjectPreference } from './subjects';

type Chromosome = string[];

function createSeededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  }

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function calculateTargets(subjects: SubjectPreference[], sessionCount: number): number[] {
  const totalWeight = subjects.reduce((sum, subject) => sum + subject.weight, 0);
  const exactTargets = subjects.map((subject) => (sessionCount * subject.weight) / totalWeight);
  const targets = exactTargets.map(Math.floor);
  const remaining = sessionCount - targets.reduce((sum, count) => sum + count, 0);
  const priority = exactTargets
    .map((target, index) => ({ index, remainder: target - Math.floor(target) }))
    .sort((left, right) => right.remainder - left.remainder);

  for (let index = 0; index < remaining; index += 1) {
    targets[priority[index].index] += 1;
  }
  return targets;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(random() * (index + 1));
    [result[index], result[otherIndex]] = [result[otherIndex], result[index]];
  }
  return result;
}

function fitness(
  chromosome: Chromosome,
  subjects: SubjectPreference[],
  targets: number[],
  daysPerWeek: number,
  sessionsPerDay: number,
): number {
  const countsBySubject = new Map<string, number>();
  for (const key of chromosome) countsBySubject.set(key, (countsBySubject.get(key) ?? 0) + 1);
  const counts = subjects.map((subject) => countsBySubject.get(subject.key) ?? 0);
  let score = counts.reduce((total, count, index) => {
    const difference = count - targets[index];
    return total + (difference * difference * 8) / Math.max(targets[index], 1);
  }, 0);

  for (let day = 0; day < daysPerWeek; day += 1) {
    const start = day * sessionsPerDay;
    const dailyCounts = new Map<string, number>();
    for (let slot = 0; slot < sessionsPerDay; slot += 1) {
      const subjectKey = chromosome[start + slot];
      dailyCounts.set(subjectKey, (dailyCounts.get(subjectKey) ?? 0) + 1);
      if (slot > 0 && subjectKey === chromosome[start + slot - 1]) score += 3;
      if (day > 0 && subjectKey === chromosome[start - sessionsPerDay + slot]) score += 0.4;
    }
    for (const count of dailyCounts.values()) {
      if (count > 2) score += (count - 2) * 1.5;
    }
  }
  return score;
}

function tournament(population: Chromosome[], scores: number[], random: () => number): Chromosome {
  let bestIndex = Math.floor(random() * population.length);
  for (let contender = 1; contender < 4; contender += 1) {
    const index = Math.floor(random() * population.length);
    if (scores[index] < scores[bestIndex]) bestIndex = index;
  }
  return population[bestIndex];
}

function countsForSubjects(chromosome: Chromosome, subjects: SubjectPreference[]): number[] {
  const countsBySubject = new Map<string, number>();
  for (const gene of chromosome) {
    countsBySubject.set(gene, (countsBySubject.get(gene) ?? 0) + 1);
  }
  return subjects.map((subject) => countsBySubject.get(subject.key) ?? 0);
}

/**
 * Repair a day-uniform child back to exact target quotas. For every underfilled
 * subject, replace one gene from an overfilled subject, choosing the position
 * with the lowest resulting penalty. A chromosome's quota is exact after repair.
 */
function repairChromosomeToTargets(
  chromosome: Chromosome,
  subjects: SubjectPreference[],
  targets: number[],
  daysPerWeek: number,
  sessionsPerDay: number,
  random: () => number,
): Chromosome {
  const repaired = [...chromosome];
  const subjectIndex = new Map(subjects.map((subject, index) => [subject.key, index]));
  const counts = countsForSubjects(repaired, subjects);

  for (let neededIndex = 0; neededIndex < subjects.length; neededIndex += 1) {
    while (counts[neededIndex] < targets[neededIndex]) {
      let selectedPosition = -1;
      let selectedPenalty = Number.POSITIVE_INFINITY;
      let selectedTie = Number.POSITIVE_INFINITY;

      for (let position = 0; position < repaired.length; position += 1) {
        const sourceIndex = subjectIndex.get(repaired[position]);
        if (sourceIndex === undefined || counts[sourceIndex] <= targets[sourceIndex]) continue;

        const original = repaired[position];
        repaired[position] = subjects[neededIndex].key;
        const candidatePenalty = fitness(
          repaired, subjects, targets, daysPerWeek, sessionsPerDay,
        );
        repaired[position] = original;
        const tie = random();

        if (
          candidatePenalty < selectedPenalty ||
          (candidatePenalty === selectedPenalty && tie < selectedTie)
        ) {
          selectedPosition = position;
          selectedPenalty = candidatePenalty;
          selectedTie = tie;
        }
      }

      if (selectedPosition < 0) {
        throw new Error("ไม่สามารถ Repair จำนวนช่วงอ่านให้ตรงกับ Weight ได้");
      }
      const sourceIndex = subjectIndex.get(repaired[selectedPosition]);
      if (sourceIndex === undefined) {
        throw new Error("พบรายวิชาในโครโมโซมที่ไม่ถูกต้อง");
      }
      repaired[selectedPosition] = subjects[neededIndex].key;
      counts[sourceIndex] -= 1;
      counts[neededIndex] += 1;
    }
  }
  return repaired;
}

/** Day Uniform crossover: inherit each whole day from either parent, then repair quotas. */
function dayUniformCrossover(
  firstParent: Chromosome,
  secondParent: Chromosome,
  subjects: SubjectPreference[],
  targets: number[],
  daysPerWeek: number,
  sessionsPerDay: number,
  random: () => number,
): Chromosome {
  const child: Chromosome = [];
  for (let day = 0; day < daysPerWeek; day += 1) {
    const parent = random() < 0.5 ? firstParent : secondParent;
    const start = day * sessionsPerDay;
    child.push(...parent.slice(start, start + sessionsPerDay));
  }
  return repairChromosomeToTargets(
    child, subjects, targets, daysPerWeek, sessionsPerDay, random,
  );
}

/** Move or swap preserves the multiset of study subjects exactly. */
function moveOrSwapMutation(chromosome: Chromosome, random: () => number): void {
  if (chromosome.length < 2) return;
  const from = Math.floor(random() * chromosome.length);
  let to = Math.floor(random() * (chromosome.length - 1));
  if (to >= from) to += 1;

  if (random() < 0.5) {
    [chromosome[from], chromosome[to]] = [chromosome[to], chromosome[from]];
    return;
  }

  const [gene] = chromosome.splice(from, 1);
  chromosome.splice(to, 0, gene);
}

/** Random pairwise local search; accept only swaps that strictly reduce penalty. */
function improveByLocalSearch(
  chromosome: Chromosome,
  subjects: SubjectPreference[],
  targets: number[],
  daysPerWeek: number,
  sessionsPerDay: number,
  iterations: number,
  random: () => number,
): Chromosome {
  const improved = [...chromosome];
  let currentPenalty = fitness(improved, subjects, targets, daysPerWeek, sessionsPerDay);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (improved.length < 2) break;
    const first = Math.floor(random() * improved.length);
    let second = Math.floor(random() * (improved.length - 1));
    if (second >= first) second += 1;
    [improved[first], improved[second]] = [improved[second], improved[first]];

    const candidatePenalty = fitness(
      improved, subjects, targets, daysPerWeek, sessionsPerDay,
    );
    if (candidatePenalty < currentPenalty) {
      currentPenalty = candidatePenalty;
    } else {
      [improved[first], improved[second]] = [improved[second], improved[first]];
    }
  }
  return improved;
}

export type ImprovedGeneticAlgorithmOptions = {
  populationSize?: number;
  generations?: number;
  mutationRate?: number;
  localSearchIterations?: number;
};

/**
 * Improved GA for controlled comparison. Unlike the legacy GA, all operators
 * preserve/repair subject quotas; crossover acts on whole days and each child
 * receives bounded local-search attempts.
 */
export function createImprovedGeneticStudySchedule(
  subjects: SubjectPreference[],
  daysPerWeek: number,
  sessionsPerDay: number,
  seed = "study-planner-improved-ga",
  options: ImprovedGeneticAlgorithmOptions = {},
): string[][] {
  validateAlgorithmInput(subjects, daysPerWeek, sessionsPerDay);
  const random = createSeededRandom(seed);
  const sessionCount = daysPerWeek * sessionsPerDay;
  const targets = calculateTargets(subjects, sessionCount);
  const populationSize = Math.max(8, Math.min(256, Math.trunc(options.populationSize ?? 96)));
  const generations = Math.max(1, Math.min(1000, Math.trunc(options.generations ?? 200)));
  const mutationRate = Math.max(0, Math.min(1, options.mutationRate ?? 0.2));
  const localSearchIterations = Math.max(
    0, Math.min(100, Math.trunc(options.localSearchIterations ?? 10)),
  );
  const { genes: targetGenes } = buildTargetGenes(subjects, sessionCount);
  const population: Chromosome[] = Array.from(
    { length: populationSize },
    () => shuffled(targetGenes, random),
  );

  let bestChromosome = [...population[0]];
  let bestPenalty = fitness(
    bestChromosome, subjects, targets, daysPerWeek, sessionsPerDay,
  );

  for (let generation = 0; generation < generations; generation += 1) {
    const scores = population.map((chromosome) =>
      fitness(chromosome, subjects, targets, daysPerWeek, sessionsPerDay),
    );
    const ranked = population
      .map((chromosome, index) => ({ chromosome, score: scores[index] }))
      .sort((left, right) => left.score - right.score);

    if (ranked[0].score < bestPenalty) {
      bestPenalty = ranked[0].score;
      bestChromosome = [...ranked[0].chromosome];
    }

    const nextPopulation = ranked.slice(0, Math.min(4, populationSize))
      .map(({ chromosome }) => [...chromosome]);

    while (nextPopulation.length < populationSize) {
      const firstParent = tournament(population, scores, random);
      const secondParent = tournament(population, scores, random);
      let child = dayUniformCrossover(
        firstParent, secondParent, subjects, targets,
        daysPerWeek, sessionsPerDay, random,
      );

      if (random() < mutationRate) {
        moveOrSwapMutation(child, random);
      }

      child = improveByLocalSearch(
        child, subjects, targets, daysPerWeek, sessionsPerDay,
        localSearchIterations, random,
      );
      const childCounts = countsForSubjects(child, subjects);
      if (childCounts.some((count, index) => count !== targets[index])) {
        throw new Error("Improved GA สร้างจำนวนช่วงอ่านไม่ตรงกับ Weight");
      }
      const childPenalty = fitness(
        child, subjects, targets, daysPerWeek, sessionsPerDay,
      );
      if (childPenalty < bestPenalty) {
        bestPenalty = childPenalty;
        bestChromosome = [...child];
      }
      nextPopulation.push(child);
    }

    population.splice(0, population.length, ...nextPopulation);
  }

  return toScheduleGrid(bestChromosome, daysPerWeek, sessionsPerDay);
}

export function createStudySchedule(
  subjects: SubjectPreference[],
  daysPerWeek: number,
  sessionsPerDay: number,
  seed = 'study-planner',
): string[][] {
  const random = createSeededRandom(seed);
  const sessionCount = daysPerWeek * sessionsPerDay;
  const targets = calculateTargets(subjects, sessionCount);
  const seedGenes: string[] = [];
  targets.forEach((count, index) => {
    for (let slot = 0; slot < count; slot += 1) seedGenes.push(subjects[index].key);
  });

  const populationSize = 96;
  const population: Chromosome[] = Array.from({ length: populationSize }, () => shuffled(seedGenes, random));
  let best: Chromosome = population[0];

  for (let generation = 0; generation < 120; generation += 1) {
    const scores = population.map((chromosome) =>
      fitness(chromosome, subjects, targets, daysPerWeek, sessionsPerDay),
    );
    const ranked = population
      .map((chromosome, index) => ({ chromosome, score: scores[index] }))
      .sort((left, right) => left.score - right.score);
    best = ranked[0].chromosome;

    const nextPopulation = ranked.slice(0, 4).map(({ chromosome }) => chromosome);
    while (nextPopulation.length < populationSize) {
      const firstParent = tournament(population, scores, random);
      const secondParent = tournament(population, scores, random);
      const firstCut = Math.floor(random() * sessionCount);
      const secondCut = firstCut + Math.floor(random() * (sessionCount - firstCut));
      const child = firstParent.map((gene, index) =>
        index >= firstCut && index <= secondCut ? secondParent[index] : gene,
      );

      if (random() < 0.22) {
        const mutationCount = random() < 0.2 ? 2 : 1;
        for (let mutation = 0; mutation < mutationCount; mutation += 1) {
          const index = Math.floor(random() * sessionCount);
          child[index] = subjects[Math.floor(random() * subjects.length)].key;
        }
      }
      nextPopulation.push(child);
    }
    population.splice(0, population.length, ...nextPopulation);
  }

  const winner = population.reduce((currentBest, chromosome) =>
    fitness(chromosome, subjects, targets, daysPerWeek, sessionsPerDay)
      < fitness(currentBest, subjects, targets, daysPerWeek, sessionsPerDay)
      ? chromosome
      : currentBest,
  best);

  return Array.from({ length: daysPerWeek }, (_, dayIndex) =>
    winner.slice(dayIndex * sessionsPerDay, (dayIndex + 1) * sessionsPerDay),
  );
}

export type ScheduleAlgorithmName =
  | "Genetic Algorithm (Original)"
  | "Genetic Algorithm (Improved)"
  | "Greedy"
  | "Rule-based"
  | "Random";

export type ScheduleAlgorithmMetrics = {
  algorithm: ScheduleAlgorithmName;
  runs: number;
  meanPenalty: number;
  bestPenalty: number;
  meanFitnessScore: number;
  bestFitnessScore: number;
  penaltyStandardDeviation: number;
  meanRuntimeMs: number;
  meanTargetDeviation: number;
  meanAdjacentRepeats: number;
  meanSameTimeRepeats: number;
};

type ScheduleRunSample = {
  penalty: number;
  runtimeMs: number;
  targetDeviation: number;
  adjacentRepeats: number;
  sameTimeRepeats: number;
};

function validateAlgorithmInput(
  subjects: SubjectPreference[],
  daysPerWeek: number,
  sessionsPerDay: number,
): void {
  if (!subjects.length) throw new Error("ต้องมีรายวิชาอย่างน้อย 1 วิชา");
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
    throw new Error("วันอ่านต่อสัปดาห์ต้องอยู่ระหว่าง 1 ถึง 7 วัน");
  }
  if (!Number.isInteger(sessionsPerDay) || sessionsPerDay < 1 || sessionsPerDay > 17) {
    throw new Error("จำนวนช่วงอ่านต่อวันไม่ถูกต้อง");
  }
  const totalWeight = subjects.reduce((total, subject) => total + Number(subject.weight), 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("Weight ของรายวิชาไม่ถูกต้อง");
  }
}

function buildTargetGenes(
  subjects: SubjectPreference[],
  sessionCount: number,
): { targets: number[]; genes: string[] } {
  const targets = calculateTargets(subjects, sessionCount);
  const genes: string[] = [];
  targets.forEach((count, index) => {
    for (let slot = 0; slot < count; slot += 1) genes.push(subjects[index].key);
  });
  return { targets, genes };
}

function toScheduleGrid(
  genes: string[],
  daysPerWeek: number,
  sessionsPerDay: number,
): string[][] {
  return Array.from({ length: daysPerWeek }, (_, dayIndex) =>
    genes.slice(dayIndex * sessionsPerDay, (dayIndex + 1) * sessionsPerDay),
  );
}

/**
 * Greedy baseline: fill each slot with the remaining subject that adds the
 * smallest immediate penalty, preferring subjects furthest behind their quota.
 */
export function createGreedyStudySchedule(
  subjects: SubjectPreference[],
  daysPerWeek: number,
  sessionsPerDay: number,
  seed = "study-scheduler-greedy",
): string[][] {
  validateAlgorithmInput(subjects, daysPerWeek, sessionsPerDay);
  const sessionCount = daysPerWeek * sessionsPerDay;
  const { targets } = buildTargetGenes(subjects, sessionCount);
  const remaining = [...targets];
  const assignedPerDay = Array.from({ length: daysPerWeek }, () =>
    subjects.map(() => 0),
  );
  const genes = Array<string>(sessionCount).fill("");
  const random = createSeededRandom(seed);

  for (let slotIndex = 0; slotIndex < sessionCount; slotIndex += 1) {
    const dayIndex = Math.floor(slotIndex / sessionsPerDay);
    const position = slotIndex % sessionsPerDay;
    let bestIndex = -1;
    let bestPenalty = Number.POSITIVE_INFINITY;
    let bestQuotaRatio = Number.NEGATIVE_INFINITY;
    let bestTie = Number.POSITIVE_INFINITY;

    for (let subjectIndex = 0; subjectIndex < subjects.length; subjectIndex += 1) {
      if (remaining[subjectIndex] <= 0) continue;
      const key = subjects[subjectIndex].key;
      let incrementalPenalty = 0;
      if (position > 0 && genes[slotIndex - 1] === key) incrementalPenalty += 3;
      if (
        dayIndex > 0 &&
        genes[slotIndex - sessionsPerDay] === key
      ) incrementalPenalty += 0.4;
      if (assignedPerDay[dayIndex][subjectIndex] >= 2) incrementalPenalty += 1.5;

      const quotaRatio = remaining[subjectIndex] / Math.max(1, targets[subjectIndex]);
      const tie = random();
      if (
        incrementalPenalty < bestPenalty ||
        (incrementalPenalty === bestPenalty && quotaRatio > bestQuotaRatio) ||
        (incrementalPenalty === bestPenalty && quotaRatio === bestQuotaRatio && tie < bestTie)
      ) {
        bestIndex = subjectIndex;
        bestPenalty = incrementalPenalty;
        bestQuotaRatio = quotaRatio;
        bestTie = tie;
      }
    }

    if (bestIndex < 0) throw new Error("Greedy ไม่สามารถจัดช่วงเรียนให้ครบได้");
    genes[slotIndex] = subjects[bestIndex].key;
    remaining[bestIndex] -= 1;
    assignedPerDay[dayIndex][bestIndex] += 1;
  }
  return toScheduleGrid(genes, daysPerWeek, sessionsPerDay);
}

/**
 * Rule-based baseline adapted to the current app's data model:
 * prioritise subject weights/remaining quotas while avoiding consecutive
 * duplicates and, when possible, limiting a subject to two sessions per day.
 * The current app has no exam-date field, so this does not pretend to use EDF.
 */
export function createRuleBasedStudySchedule(
  subjects: SubjectPreference[],
  daysPerWeek: number,
  sessionsPerDay: number,
): string[][] {
  validateAlgorithmInput(subjects, daysPerWeek, sessionsPerDay);
  const sessionCount = daysPerWeek * sessionsPerDay;
  const { targets } = buildTargetGenes(subjects, sessionCount);
  const remaining = [...targets];
  const assignedPerDay = Array.from({ length: daysPerWeek }, () =>
    subjects.map(() => 0),
  );
  const genes = Array<string>(sessionCount).fill("");

  const orderedSubjects = subjects.map((_, index) => index).sort((a, b) =>
    subjects[b].weight - subjects[a].weight || a - b,
  );

  for (let slotIndex = 0; slotIndex < sessionCount; slotIndex += 1) {
    const dayIndex = Math.floor(slotIndex / sessionsPerDay);
    const position = slotIndex % sessionsPerDay;
    const isSameAsPrevious = (subjectIndex: number) =>
      position > 0 && genes[slotIndex - 1] === subjects[subjectIndex].key;
    const isSameAsPreviousDay = (subjectIndex: number) =>
      dayIndex > 0 && genes[slotIndex - sessionsPerDay] === subjects[subjectIndex].key;

    const tiers = [
      (index: number) =>
        !isSameAsPrevious(index) &&
        !isSameAsPreviousDay(index) &&
        assignedPerDay[dayIndex][index] < 2,
      (index: number) =>
        !isSameAsPrevious(index) && assignedPerDay[dayIndex][index] < 3,
      (index: number) => !isSameAsPrevious(index),
      () => true,
    ];
    let eligible: number[] = [];
    for (const canUse of tiers) {
      eligible = orderedSubjects.filter((index) => remaining[index] > 0 && canUse(index));
      if (eligible.length) break;
    }

    eligible.sort((a, b) => {
      const ratioA = remaining[a] / Math.max(1, targets[a]);
      const ratioB = remaining[b] / Math.max(1, targets[b]);
      return ratioB - ratioA || subjects[b].weight - subjects[a].weight || a - b;
    });
    const chosen = eligible[0];
    if (chosen === undefined) throw new Error("Rule-based ไม่สามารถจัดช่วงเรียนให้ครบได้");
    genes[slotIndex] = subjects[chosen].key;
    remaining[chosen] -= 1;
    assignedPerDay[dayIndex][chosen] += 1;
  }
  return toScheduleGrid(genes, daysPerWeek, sessionsPerDay);
}

/** Random baseline: shuffle the same target-weighted gene multiset used by GA. */
export function createRandomStudySchedule(
  subjects: SubjectPreference[],
  daysPerWeek: number,
  sessionsPerDay: number,
  seed = "study-scheduler-random",
): string[][] {
  validateAlgorithmInput(subjects, daysPerWeek, sessionsPerDay);
  const { genes } = buildTargetGenes(subjects, daysPerWeek * sessionsPerDay);
  return toScheduleGrid(shuffled(genes, createSeededRandom(seed)), daysPerWeek, sessionsPerDay);
}

function measureSchedule(
  grid: string[][],
  subjects: SubjectPreference[],
  targets: number[],
  daysPerWeek: number,
  sessionsPerDay: number,
): Omit<ScheduleRunSample, "runtimeMs"> {
  const genes = grid.flat();
  const score = fitness(genes, subjects, targets, daysPerWeek, sessionsPerDay);
  const counts = subjects.map((subject) => genes.filter((key) => key === subject.key).length);
  const targetDeviation = counts.reduce(
    (sum, count, index) => sum + Math.abs(count - targets[index]),
    0,
  );
  let adjacentRepeats = 0;
  let sameTimeRepeats = 0;
  for (let day = 0; day < daysPerWeek; day += 1) {
    const start = day * sessionsPerDay;
    for (let slot = 0; slot < sessionsPerDay; slot += 1) {
      const index = start + slot;
      if (slot > 0 && genes[index] === genes[index - 1]) adjacentRepeats += 1;
      if (day > 0 && genes[index] === genes[index - sessionsPerDay]) sameTimeRepeats += 1;
    }
  }
  return { penalty: score, targetDeviation, adjacentRepeats, sameTimeRepeats };
}

function aggregateSamples(
  algorithm: ScheduleAlgorithmName,
  samples: ScheduleRunSample[],
  sessionCount: number,
): ScheduleAlgorithmMetrics {
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const penalties = samples.map((sample) => sample.penalty);
  const meanPenalty = mean(penalties);
  const variance = penalties.length > 1
    ? penalties.reduce((sum, value) => sum + (value - meanPenalty) ** 2, 0) / (penalties.length - 1)
    : 0;
  return {
    algorithm,
    runs: samples.length,
    meanPenalty: Number(meanPenalty.toFixed(3)),
    bestPenalty: Number(Math.min(...penalties).toFixed(3)),
    meanFitnessScore: Number((100 / (1 + meanPenalty / Math.max(1, sessionCount))).toFixed(2)),
    bestFitnessScore: Number((100 / (1 + Math.min(...penalties) / Math.max(1, sessionCount))).toFixed(2)),
    penaltyStandardDeviation: Number(Math.sqrt(variance).toFixed(3)),
    meanRuntimeMs: Number(mean(samples.map((sample) => sample.runtimeMs)).toFixed(2)),
    meanTargetDeviation: Number(mean(samples.map((sample) => sample.targetDeviation)).toFixed(2)),
    meanAdjacentRepeats: Number(mean(samples.map((sample) => sample.adjacentRepeats)).toFixed(2)),
    meanSameTimeRepeats: Number(mean(samples.map((sample) => sample.sameTimeRepeats)).toFixed(2)),
  };
}

/**
 * Compare both GA variants and three baselines with the same target distribution and objective.
 * Lower penalty is better. GA and Random are repeated to account for seeds;
 * the two deterministic baselines run once.
 */
export function compareStudyAlgorithms(
  subjects: SubjectPreference[],
  daysPerWeek: number,
  sessionsPerDay: number,
  options: { runs?: number; seed?: string } = {},
): {
  runsPerStochasticMethod: number;
  sessionCount: number;
  targetAllocation: Array<{ key: string; label: string; weight: number; targetSessions: number }>;
  results: ScheduleAlgorithmMetrics[];
} {
  validateAlgorithmInput(subjects, daysPerWeek, sessionsPerDay);
  const runs = Math.max(2, Math.min(10, Math.trunc(options.runs ?? 5)));
  const seed = options.seed ?? "study-scheduler-comparison";
  const sessionCount = daysPerWeek * sessionsPerDay;
  const targets = calculateTargets(subjects, sessionCount);
  const sample = (makeGrid: () => string[][]): ScheduleRunSample => {
    const startedAt = performance.now();
    const grid = makeGrid();
    const metrics = measureSchedule(grid, subjects, targets, daysPerWeek, sessionsPerDay);
    return { ...metrics, runtimeMs: Number((performance.now() - startedAt).toFixed(2)) };
  };

  const gaSamples: ScheduleRunSample[] = [];
  const improvedGaSamples: ScheduleRunSample[] = [];
  const randomSamples: ScheduleRunSample[] = [];
  for (let run = 0; run < runs; run += 1) {
    const gaSeed = `${seed}:ga:${run + 1}`;
    gaSamples.push(sample(() => createStudySchedule(subjects, daysPerWeek, sessionsPerDay, gaSeed)));
    const improvedSeed = `${seed}:improved-ga:${run + 1}`;
    improvedGaSamples.push(sample(() => createImprovedGeneticStudySchedule(
      subjects, daysPerWeek, sessionsPerDay, improvedSeed,
      { populationSize: 96, generations: 200, mutationRate: 0.2, localSearchIterations: 10 },
    )));
    const randomSeed = `${seed}:random:${run + 1}`;
    randomSamples.push(sample(() => createRandomStudySchedule(subjects, daysPerWeek, sessionsPerDay, randomSeed)));
  }

  const greedySamples = [sample(() => createGreedyStudySchedule(subjects, daysPerWeek, sessionsPerDay, `${seed}:greedy`))];
  const ruleSamples = [sample(() => createRuleBasedStudySchedule(subjects, daysPerWeek, sessionsPerDay))];

  return {
    runsPerStochasticMethod: runs,
    sessionCount,
    targetAllocation: subjects.map((subject, index) => ({
      key: subject.key,
      label: subject.label,
      weight: subject.weight,
      targetSessions: targets[index],
    })),
    results: [
      aggregateSamples("Genetic Algorithm (Original)", gaSamples, sessionCount),
      aggregateSamples("Genetic Algorithm (Improved)", improvedGaSamples, sessionCount),
      aggregateSamples("Greedy", greedySamples, sessionCount),
      aggregateSamples("Rule-based", ruleSamples, sessionCount),
      aggregateSamples("Random", randomSamples, sessionCount),
    ].sort((a, b) => a.meanPenalty - b.meanPenalty),
  };
}
