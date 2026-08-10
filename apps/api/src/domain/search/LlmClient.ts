export type GroundedAnswer = {
  answer: string;
  grounded: boolean;
  usedCitationIndexes: number[];
};

export interface LlmClient {
  answerWithContext(input: {
    question: string;
    passages: Array<{ index: number; source: string; text: string }>;
  }): Promise<GroundedAnswer>;
}
