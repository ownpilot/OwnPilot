/**
 * Knowledge Graph API Routes
 *
 * Entity/relation management, hybrid search, LightRAG integration.
 * Knowledge is scoped by user_id + agent_id.
 */
import { Hono } from 'hono';
import { getUserId, apiResponse, apiError, getPaginationParams, ERROR_CODES } from './helpers.js';
import { getGraphRagService } from '../services/graph-rag-service.js';

const app = new Hono();

// POST /knowledge-graph/extract — Extract entities/relations from text
app.post('/extract', async (c) => {
  const userId = getUserId(c);
  const { text, agentId } = await c.req.json();
  if (!text) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'text is required' }, 400);
  const result = await getGraphRagService().extractKnowledge(text, userId, agentId);
  return apiResponse(c, result);
});

// POST /knowledge-graph/ingest — Ingest extracted knowledge
app.post('/ingest', async (c) => {
  const userId = getUserId(c);
  const { entities, relations, agentId, sourceId } = await c.req.json();
  const result = await getGraphRagService().ingestKnowledge({ entities, relations }, userId, agentId, sourceId);
  return apiResponse(c, result);
});

// POST /knowledge-graph/ingest-text — Extract + ingest in one call
app.post('/ingest-text', async (c) => {
  const userId = getUserId(c);
  const { text, agentId, sourceId } = await c.req.json();
  if (!text) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'text is required' }, 400);
  const service = getGraphRagService();
  const extracted = await service.extractKnowledge(text, userId, agentId);
  const result = await service.ingestKnowledge(extracted, userId, agentId, sourceId);
  return apiResponse(c, { ...result, extracted });
});

// GET /knowledge-graph/search?q=...&mode=hybrid&agentId=...&topK=10
app.get('/search', async (c) => {
  const userId = getUserId(c);
  const q = c.req.query('q');
  if (!q) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'q is required' }, 400);
  const mode = (c.req.query('mode') ?? 'hybrid') as 'hybrid' | 'vector' | 'graph' | 'keyword';
  const agentId = c.req.query('agentId') ?? undefined;
  const topK = parseInt(c.req.query('topK') ?? '10', 10);
  const result = await getGraphRagService().search(q, userId, { mode, agentId, topK });
  return apiResponse(c, result);
});

// GET /knowledge-graph/entities?agentId=...&type=...
app.get('/entities', async (c) => {
  const userId = getUserId(c);
  const agentId = c.req.query('agentId') ?? undefined;
  const type = c.req.query('type') ?? undefined;
  const { limit, offset } = getPaginationParams(c);
  const result = await getGraphRagService().listEntities(userId, agentId, { type, limit, offset });
  return apiResponse(c, result);
});

// GET /knowledge-graph/entities/:id
app.get('/entities/:id', async (c) => {
  const userId = getUserId(c);
  const entity = await getGraphRagService().getEntity(c.req.param('id'), userId);
  if (!entity) return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Entity not found' }, 404);
  return apiResponse(c, entity);
});

// GET /knowledge-graph/entities/:id/neighbors?depth=2
app.get('/entities/:id/neighbors', async (c) => {
  const userId = getUserId(c);
  const depth = parseInt(c.req.query('depth') ?? '2', 10);
  const result = await getGraphRagService().getNeighbors(c.req.param('id'), userId, depth);
  return apiResponse(c, result);
});

// DELETE /knowledge-graph/entities/:id
app.delete('/entities/:id', async (c) => {
  const userId = getUserId(c);
  await getGraphRagService().deleteEntity(c.req.param('id'), userId);
  return apiResponse(c, { deleted: true });
});

// --- Collections ---

// POST /knowledge-graph/collections
app.post('/collections', async (c) => {
  const userId = getUserId(c);
  const { agentId, name, description } = await c.req.json();
  if (!name) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'name is required' }, 400);
  const collection = await getGraphRagService().createCollection(userId, agentId ?? null, name, description);
  return apiResponse(c, collection, 201);
});

// GET /knowledge-graph/collections?agentId=...
app.get('/collections', async (c) => {
  const userId = getUserId(c);
  const agentId = c.req.query('agentId') ?? undefined;
  const collections = await getGraphRagService().listCollections(userId, agentId);
  return apiResponse(c, collections);
});

// DELETE /knowledge-graph/collections/:id
app.delete('/collections/:id', async (c) => {
  const userId = getUserId(c);
  await getGraphRagService().deleteCollection(c.req.param('id'), userId);
  return apiResponse(c, { deleted: true });
});

// --- LightRAG ---

// GET /knowledge-graph/lightrag/status
app.get('/lightrag/status', async (c) => {
  const available = await getGraphRagService().isLightRagAvailable();
  return apiResponse(c, { available });
});

// POST /knowledge-graph/lightrag/insert
app.post('/lightrag/insert', async (c) => {
  const userId = getUserId(c);
  const { text, agentId, metadata } = await c.req.json();
  if (!text) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'text is required' }, 400);
  await getGraphRagService().insertDocument(text, userId, agentId, metadata);
  return apiResponse(c, { inserted: true });
});

// POST /knowledge-graph/lightrag/query
app.post('/lightrag/query', async (c) => {
  const { query, mode } = await c.req.json();
  if (!query) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'query is required' }, 400);
  const result = await getGraphRagService().queryLightRag(query, mode);
  return apiResponse(c, { result });
});

// POST /knowledge-graph/decay — Apply memory decay
app.post('/decay', async (c) => {
  const userId = getUserId(c);
  const { decayFactor } = await c.req.json().catch(() => ({}));
  const affected = await getGraphRagService().applyDecay(userId, decayFactor);
  return apiResponse(c, { affected });
});

export const knowledgeGraphRoutes = app;
