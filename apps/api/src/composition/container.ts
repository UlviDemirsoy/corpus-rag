import { env } from "../config/env.js";
import { IngestCorpus } from "../application/ingest/IngestCorpus.js";
import { GetDashboardData } from "../application/analytics/GetDashboardData.js";
import { RagAnswer } from "../application/search/RagAnswer.js";
import { SemanticSearch } from "../application/search/SemanticSearch.js";
import { createAuth } from "../infrastructure/auth/betterAuth.js";
import { db } from "../infrastructure/db/client.js";
import { DrizzleDocumentRepository } from "../infrastructure/db/repositories/DrizzleDocumentRepository.js";
import { DrizzleIngestionJobRepository } from "../infrastructure/db/repositories/DrizzleIngestionJobRepository.js";
import { DrizzleSearchAnalyticsRepository } from "../infrastructure/db/repositories/DrizzleSearchAnalyticsRepository.js";
import { OpenAIChatClient } from "../infrastructure/llm/OpenAIChatClient.js";
import { OpenAIEmbedder } from "../infrastructure/llm/OpenAIEmbedder.js";
import { QdrantVectorStore } from "../infrastructure/qdrant/QdrantVectorStore.js";

export function createContainer() {
  const auth = createAuth();
  const documents = new DrizzleDocumentRepository(db);
  const jobs = new DrizzleIngestionJobRepository(db);
  const analytics = new DrizzleSearchAnalyticsRepository(db);
  const vectors = new QdrantVectorStore();
  const embedder = new OpenAIEmbedder();
  const llm = new OpenAIChatClient();

  const semanticSearch = new SemanticSearch(embedder, vectors, analytics);
  const ragAnswer = new RagAnswer(semanticSearch, llm, analytics);
  const ingestCorpus = new IngestCorpus(documents, jobs, vectors, embedder);
  const getDashboardData = new GetDashboardData(documents, jobs, analytics, vectors);

  return {
    env,
    auth,
    documents,
    jobs,
    analytics,
    vectors,
    semanticSearch,
    ragAnswer,
    ingestCorpus,
    getDashboardData,
  };
}

export type Container = ReturnType<typeof createContainer>;
