export type GroundedAnswer = {
  answer: string;
  grounded: boolean;
  usedCitationIndexes: number[];
};

export type PassageForLlm = {
  index: number;
  source: string;
  text: string;
};

export interface LlmClient {
  answerWithContext(input: {
    question: string;
    passages: PassageForLlm[];
  }): Promise<GroundedAnswer>;

  /**
   * Streams answer text deltas; return value is the final grounded payload.
   * AsyncGenerator yields string chunks, then returns GroundedAnswer.
   */
  streamAnswerWithContext(input: {
    question: string;
    passages: PassageForLlm[];
  }): AsyncGenerator<string, GroundedAnswer, void>;
}
