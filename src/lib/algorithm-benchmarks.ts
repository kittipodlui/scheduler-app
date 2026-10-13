import type { PriorityWeight, SubjectPreference } from "./subjects";
import {
  compareStudyAlgorithms,
  type ScheduleAlgorithmName,
  type ScheduleAlgorithmMetrics,
} from "./genetic-algorithm";

type SampleSubject = { label: string; weight: PriorityWeight };

export type AlgorithmSampleScenario = {
  id: string;
  name: string;
  description: string;
  daysPerWeek: number;
  sessionsPerDay: number;
  subjects: SampleSubject[];
};

/**
 * Fixed synthetic cases for reproducible, apples-to-apples algorithm testing.
 * Every case uses subject weights that sum to 100%, like the live planner.
 */
export const ALGORITHM_SAMPLE_SCENARIOS: AlgorithmSampleScenario[] = [
  {
    id: "small-balanced",
    name: "ตัวอย่าง 1 · ตารางขนาดเล็ก",
    description: "4 วิชา น้ำหนัก 30/30/20/20 และ 6 ช่วงอ่าน",
    daysPerWeek: 3,
    sessionsPerDay: 2,
    subjects: [
      { label: "คณิตศาสตร์", weight: 30 },
      { label: "ภาษาอังกฤษ", weight: 30 },
      { label: "วิทยาศาสตร์", weight: 20 },
      { label: "ภาษาไทย", weight: 20 },
    ],
  },
  {
    id: "equal-weights",
    name: "ตัวอย่าง 2 · น้ำหนักเท่ากัน",
    description: "4 วิชา น้ำหนักวิชาละ 25% และ 15 ช่วงอ่าน",
    daysPerWeek: 5,
    sessionsPerDay: 3,
    subjects: [
      { label: "คณิตศาสตร์", weight: 25 },
      { label: "ภาษาอังกฤษ", weight: 25 },
      { label: "วิทยาศาสตร์", weight: 25 },
      { label: "สังคมศึกษา", weight: 25 },
    ],
  },
  {
    id: "five-subjects",
    name: "ตัวอย่าง 3 · หลายวิชาน้ำหนักเท่ากัน",
    description: "5 วิชา น้ำหนักวิชาละ 20% และ 15 ช่วงอ่าน",
    daysPerWeek: 5,
    sessionsPerDay: 3,
    subjects: [
      { label: "คณิตศาสตร์", weight: 20 },
      { label: "ภาษาอังกฤษ", weight: 20 },
      { label: "วิทยาศาสตร์", weight: 20 },
      { label: "สังคมศึกษา", weight: 20 },
      { label: "ภาษาไทย", weight: 20 },
    ],
  },
  {
    id: "priority-subjects",
    name: "ตัวอย่าง 4 · เน้นวิชาหลัก",
    description: "2 วิชาหลักรวม 60% และ 18 ช่วงอ่าน",
    daysPerWeek: 6,
    sessionsPerDay: 3,
    subjects: [
      { label: "คณิตศาสตร์", weight: 30 },
      { label: "ภาษาอังกฤษ", weight: 30 },
      { label: "วิทยาศาสตร์", weight: 20 },
      { label: "สังคมศึกษา", weight: 20 },
    ],
  },
  {
    id: "busy-week",
    name: "ตัวอย่าง 5 · ตารางแน่น 6 วิชา",
    description: "6 วิชา น้ำหนัก 20/20/20/20/10/10 และ 28 ช่วงอ่าน",
    daysPerWeek: 7,
    sessionsPerDay: 4,
    subjects: [
      { label: "คณิตศาสตร์", weight: 20 },
      { label: "ภาษาอังกฤษ", weight: 20 },
      { label: "วิทยาศาสตร์", weight: 20 },
      { label: "สังคมศึกษา", weight: 20 },
      { label: "ภาษาไทย", weight: 10 },
      { label: "คอมพิวเตอร์", weight: 10 },
    ],
  },
];

const subjectColors = [
  "#3979a8",
  "#28735b",
  "#d07842",
  "#8064a2",
  "#a25d74",
  "#318b88",
];

function toSubjectPreferences(
  scenario: AlgorithmSampleScenario,
): SubjectPreference[] {
  return scenario.subjects.map((subject, index) => ({
    key: `sample:${scenario.id}:${index + 1}`,
    label: subject.label,
    color: subjectColors[index % subjectColors.length],
    weight: subject.weight,
    kind: "subject",
    futureNote: "",
    lectureNotes: "",
  }));
}

export type AlgorithmSampleResult = {
  id: string;
  name: string;
  description: string;
  daysPerWeek: number;
  sessionsPerDay: number;
  subjects: SampleSubject[];
  sessionCount: number;
  winnerAlgorithms: ScheduleAlgorithmName[];
  results: ScheduleAlgorithmMetrics[];
};

export type AlgorithmSampleBenchmarkReport = {
  runsPerStochasticMethod: number;
  improvedGaSettings: {
    populationSize: number;
    generations: number;
    mutationRate: number;
    localSearchIterations: number;
  };
  scoringRule: string;
  cases: AlgorithmSampleResult[];
  overall: Array<{
    algorithm: ScheduleAlgorithmName;
    averageFitnessScore: number;
    averageNormalizedPenalty: number;
    bestCaseWins: number;
  }>;
};

/**
 * Executes both GA variants and Random five times with different fixed seeds per case.
 * Greedy and Rule-based are evaluated once because they are rule-driven.
 * Timing values are measured live and can vary slightly across machines.
 */
export function runAlgorithmSampleBenchmarks(): AlgorithmSampleBenchmarkReport {
  const runsPerStochasticMethod = 5;
  const improvedGaSettings = {
    populationSize: 96,
    generations: 200,
    mutationRate: 0.2,
    localSearchIterations: 10,
  } as const;
  const cases: AlgorithmSampleResult[] = ALGORITHM_SAMPLE_SCENARIOS.map(
    (scenario) => {
      const subjects = toSubjectPreferences(scenario);
      const comparison = compareStudyAlgorithms(
        subjects,
        scenario.daysPerWeek,
        scenario.sessionsPerDay,
        { runs: runsPerStochasticMethod, seed: `sample-benchmark:${scenario.id}` },
      );
      const lowestPenalty = Math.min(
        ...comparison.results.map((result) => result.meanPenalty),
      );
      return {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        daysPerWeek: scenario.daysPerWeek,
        sessionsPerDay: scenario.sessionsPerDay,
        subjects: scenario.subjects,
        sessionCount: comparison.sessionCount,
        winnerAlgorithms: comparison.results
          .filter((result) => Math.abs(result.meanPenalty - lowestPenalty) < 0.0005)
          .map((result) => result.algorithm),
        results: comparison.results,
      };
    },
  );

  const algorithmNames: ScheduleAlgorithmName[] = [
    "Genetic Algorithm (Original)",
    "Genetic Algorithm (Improved)",
    "Greedy",
    "Rule-based",
    "Random",
  ];
  const overall = algorithmNames.map((algorithm) => {
    const relevantResults = cases.map((sampleCase) => ({
      sampleCase,
      result: sampleCase.results.find((result) => result.algorithm === algorithm)!,
    }));
    const average = (numbers: number[]) =>
      numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    const bestCaseWins = cases.reduce(
      (wins, sampleCase) =>
        wins + (sampleCase.winnerAlgorithms.includes(algorithm) ? 1 : 0),
      0,
    );
    return {
      algorithm,
      averageFitnessScore: Number(
        average(relevantResults.map(({ result }) => result.meanFitnessScore)).toFixed(2),
      ),
      // Normalize by slots because test cases have different sizes.
      averageNormalizedPenalty: Number(
        average(
          relevantResults.map(
            ({ sampleCase, result }) => result.meanPenalty / sampleCase.sessionCount,
          ),
        ).toFixed(4),
      ),
      bestCaseWins,
    };
  }).sort(
    (left, right) =>
      right.averageFitnessScore - left.averageFitnessScore ||
      left.averageNormalizedPenalty - right.averageNormalizedPenalty,
  );

  return {
    runsPerStochasticMethod,
    improvedGaSettings,
    scoringRule: "Fitness Score = 100 / (1 + Penalty / จำนวนช่วงอ่าน); สูงกว่าดีกว่า ส่วน Penalty ยิ่งต่ำยิ่งดี",
    cases,
    overall,
  };
}
