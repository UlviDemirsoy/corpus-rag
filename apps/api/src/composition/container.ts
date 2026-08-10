import { env } from "../config/env.js";
import { IngestCorpus } from "../application/ingest/IngestCorpus.js";
import { GetDashboardData } from "../application/analytics/GetDashboardData.js";
import { RagAnswer } from "../application/search/RagAnswer.js";
import { SemanticSearch } from "../application/search/SemanticSearch.js";
import { ManageUsers } from "../application/users/ManageUsers.js";
import { createAuth } from "../infrastructure/auth/betterAuth.js";
import { db } from "../infrastructure/db/client.js";
import { DrizzleDocumentRepository } from "../infrastructure/db/repositories/DrizzleDocumentRepository.js";
import { DrizzleIngestionJobRepository } from "../infrastructure/db/repositories/DrizzleIngestionJobRepository.js";
import { DrizzleSearchAnalyticsRepository } from "../infrastructure/db/repositories/DrizzleSearchAnalyticsRepository.js";
import { DrizzleUserRepository } from "../infrastructure/db/repositories/DrizzleUserRepository.js";
import { OpenAIChatClient } from "../infrastructure/llm/OpenAIChatClient.js";
import { OpenAIEmbedder } from "../infrastructure/llm/OpenAIEmbedder.js";
import { OpenAIReranker } from "../infrastructure/llm/OpenAIReranker.js";
import { QdrantVectorStore } from "../infrastructure/qdrant/QdrantVectorStore.js";
import { OkapiBm25LexicalSearch } from "../infrastructure/search/OkapiBm25LexicalSearch.js";

export function createContainer() {
  const auth = createAuth();
  const documents = new DrizzleDocumentRepository(db);
  const jobs = new DrizzleIngestionJobRepository(db);
  const analytics = new DrizzleSearchAnalyticsRepository(db);
  const users = new DrizzleUserRepository(db);
  const vectors = new QdrantVectorStore();
  const embedder = new OpenAIEmbedder();
  const llm = new OpenAIChatClient();
  const reranker = new OpenAIReranker();
  const lexical = new OkapiBm25LexicalSearch(vectors);

  const semanticSearch = new SemanticSearch(
    embedder,
    vectors,
    analytics,
    reranker,
    lexical,
  );
  const ragAnswer = new RagAnswer(semanticSearch, llm, analytics);
  const ingestCorpus = new IngestCorpus(documents, jobs, vectors, embedder, (strategy) =>
    lexical.invalidate(strategy),
  );
  const getDashboardData = new GetDashboardData(documents, jobs, analytics, vectors);
  const manageUsers = new ManageUsers(users, auth);

  return {
    env,
    auth,
    documents,
    jobs,
    analytics,
    users,
    vectors,
    semanticSearch,
    ragAnswer,
    ingestCorpus,
    getDashboardData,
    manageUsers,
  };
}

export type Container = ReturnType<typeof createContainer>;
