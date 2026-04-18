"""
chat.py — /api/chat
RAG pipeline:
1. Extract intent from user message
2. Query Neo4j Knowledge Graph for relevant nodes
3. Get price estimate from XGBoost if flat details mentioned
4. Build context from KG + rules + SHAP
5. Stream response from local Ollama (default) or Gemini 2.5
"""

import os
import json

import requests
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
import google.generativeai as genai
from neo4j import GraphDatabase

from backend.hdb_towns import MATURE_ESTATES, TOWNS
from backend.models import ChatRequest
from backend.main import state

router = APIRouter()

# ollama | gemini | auto  (auto = try Ollama first, then Gemini)
CHAT_PROVIDER = os.environ.get('CHAT_PROVIDER', 'ollama').strip().lower()
OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma3').strip() or 'gemma3'


# ── Gemini setup (optional) ───────────────────────────────────────
GEMINI_AVAILABLE = False
gemini = None
_api_key = os.environ.get('GEMINI_API_KEY', '').strip()
if _api_key:
  try:
    genai.configure(api_key=_api_key)
    gemini = genai.GenerativeModel(
      model_name='gemini-2.5-flash',
      generation_config=genai.GenerationConfig(
        temperature=0.3,
        max_output_tokens=1024,
      ),
    )
    GEMINI_AVAILABLE = True
    print('✅ Gemini configured for chat (fallback or CHAT_PROVIDER=gemini)')
  except Exception as e:  # pragma: no cover - runtime config path
    print(f'⚠️ Gemini not available: {e}')
else:
  print('ℹ️ GEMINI_API_KEY unset — chat uses Ollama unless CHAT_PROVIDER=gemini')


def _sse_text_chunk(text: str) -> str:
  """Single-line SSE payload — newlines inside text break line-oriented clients."""
  safe = (text or '').replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ')
  return f'data: {safe}\n\n'


def _ollama_chat_stream(messages: list[dict]):
  """Yields text deltas from Ollama /api/chat (streaming NDJSON)."""
  url = f'{OLLAMA_BASE_URL}/api/chat'
  payload = {
    'model': OLLAMA_MODEL,
    'messages': messages,
    'stream': True,
    'options': {'temperature': 0.3, 'num_predict': 1024},
  }
  with requests.post(url, json=payload, stream=True, timeout=120) as resp:
    resp.raise_for_status()
    for line in resp.iter_lines(decode_unicode=True):
      if not line:
        continue
      try:
        data = json.loads(line)
      except json.JSONDecodeError:
        continue
      msg = data.get('message') or {}
      piece = msg.get('content') or ''
      if piece:
        yield piece
      if data.get('done'):
        break


# ── Neo4j setup ───────────────────────────────────────────────────
NEO4J_URI = os.environ.get('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.environ.get('NEO4J_USER', 'neo4j')
NEO4J_PASS = os.environ.get('NEO4J_PASSWORD', 'password')

try:
  neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
  neo4j_driver.verify_connectivity()
  NEO4J_AVAILABLE = True
  print('✅ Neo4j connected')
except Exception as e:  # pragma: no cover - connectivity setup
  neo4j_driver = None
  NEO4J_AVAILABLE = False
  print(f'⚠️  Neo4j not available: {e} — will use rules-only context')


# ── Intent extraction ─────────────────────────────────────────────
# TOWNS + MATURE_ESTATES imported from backend.hdb_towns (single source of truth).


def extract_intent(message: str) -> dict:
  msg = message.lower()
  intent = {
    'towns': [t for t in TOWNS if t.lower() in msg],
    'wants_price': any(
      w in msg for w in ['price', 'cost', 'how much', 'afford', 'budget', 'worth']
    ),
    'wants_comparison': any(
      w in msg for w in ['vs', 'versus', 'compare', 'better', 'difference', 'between']
    ),
    'wants_explanation': any(
      w in msg for w in ['why', 'explain', 'reason', 'factor', 'affect', 'drive', 'impact']
    ),
    'wants_rules': any(
      w in msg for w in ['rule', 'pattern', 'typical', 'usually', 'tend', 'common']
    ),
    'wants_schools': any(
      w in msg for w in ['school', 'primary', 'mrt', 'transport', 'amenity', 'hawker']
    ),
    'flat_type': None,
  }
  for ft in ['1 room', '2 room', '3 room', '4 room', '5 room', 'executive']:
    if ft in msg:
      intent['flat_type'] = ft.upper()
      break
  return intent


# ── Neo4j context queries ─────────────────────────────────────────
def query_neo4j_for_towns(towns: list[str]) -> str:
  """Query Neo4j for town info, nearby MRTs, schools, and policies."""
  if not NEO4J_AVAILABLE or not towns:
    return ''

  context_parts: list[str] = []
  with neo4j_driver.session() as session:
    for town in towns[:2]:
      result = session.run(
        """
        MATCH (t:Town {name: $town})
        OPTIONAL MATCH (t)-[:HAS_MRT]->(m:MRT)
        OPTIONAL MATCH (t)-[:HAS_SCHOOL]->(s:School)
        RETURN t.name AS name,
               t.is_mature AS is_mature,
               t.region AS region,
               collect(DISTINCT m.name)[..5] AS mrts,
               collect(DISTINCT s.name)[..5] AS schools
        """,
        town=town,
      )

      for record in result:
        mature_str = 'mature estate' if record['is_mature'] else 'non-mature estate'
        mrts = ', '.join(record['mrts']) if record['mrts'] else 'none found'
        schools = ', '.join(record['schools']) if record['schools'] else 'none found'
        context_parts.append(
          f"Town: {record['name']} ({mature_str}, {record['region']} region)\n"
          f'  Nearby MRTs: {mrts}\n'
          f'  Nearby schools: {schools}'
        )

    # Policy impacts
    result = session.run(
      """
      MATCH (p:Policy)
      RETURN p.name AS name, p.year AS year, p.description AS desc
      ORDER BY p.year DESC LIMIT 5
      """
    )
    policies = [f"- {r['name']} ({r['year']}): {r['desc']}" for r in result]
    if policies:
      context_parts.append('Recent HDB policies:\n' + '\n'.join(policies))

  return '\n\n'.join(context_parts)


def get_neo4j_kb_data() -> dict:
  """Export Neo4j KB as nodes and links for graph + table views. Stable ids: Type:name."""
  if not NEO4J_AVAILABLE or neo4j_driver is None:
    return {'nodes': [], 'links': [], 'error': 'Neo4j not available'}

  nodes: list[dict] = []
  links: list[dict] = []

  try:
    with neo4j_driver.session() as session:
      # ── Nodes by label (stable id = Type:primary_key) ─────────────────────
      # Towns
      result = session.run('MATCH (t:Town) RETURN t.name AS name, t.region AS region, t.is_mature AS is_mature, t.median_price AS median_price, t.tx_count AS tx_count')
      for r in result:
        name = r['name'] or ''
        nodes.append({
          'id': f"Town:{name}",
          'label': name,
          'type': 'Town',
          'region': r['region'],
          'is_mature': r['is_mature'],
          'median_price': r['median_price'],
          'tx_count': r['tx_count'],
        })

      # MRT
      result = session.run('MATCH (m:MRT) RETURN m.name AS name')
      for r in result:
        name = r['name'] or ''
        nodes.append({'id': f"MRT:{name}", 'label': name, 'type': 'MRT'})

      # School
      result = session.run('MATCH (s:School) RETURN s.name AS name, s.is_top AS is_top')
      for r in result:
        name = r['name'] or ''
        nodes.append({'id': f"School:{name}", 'label': name, 'type': 'School', 'is_top': r['is_top']})

      # Policy
      result = session.run('MATCH (p:Policy) RETURN p.name AS name, p.year AS year, p.impact AS impact')
      for r in result:
        name = r['name'] or ''
        nodes.append({'id': f"Policy:{name}", 'label': name, 'type': 'Policy', 'year': r['year'], 'impact': r['impact']})

      # Region
      result = session.run('MATCH (r:Region) RETURN r.name AS name')
      for r in result:
        name = r['name'] or ''
        nodes.append({'id': f"Region:{name}", 'label': name, 'type': 'Region'})

      # Rule
      result = session.run('MATCH (r:Rule) RETURN r.id AS id, r.conditions AS conditions, r.confidence AS confidence')
      for r in result:
        id_val = r['id'] or ''
        label = (r['conditions'] or '')[:50] + ('...' if (r['conditions'] or '') and len(r['conditions'] or '') > 50 else '')
        nodes.append({'id': f"Rule:{id_val}", 'label': label or id_val, 'type': 'Rule', 'confidence': r['confidence']})

      # ── Relationships ────────────────────────────────────────────────────
      # (Town)-[:HAS_MRT {dist_km}]->(MRT)
      result = session.run(
        'MATCH (t:Town)-[r:HAS_MRT]->(m:MRT) RETURN t.name AS src_name, m.name AS tgt_name, r.dist_km AS dist_km'
      )
      for r in result:
        links.append({
          'source': f"Town:{r['src_name']}",
          'target': f"MRT:{r['tgt_name']}",
          'type': 'HAS_MRT',
          'dist_km': r['dist_km'],
        })

      # (Town)-[:HAS_SCHOOL]->(School)
      result = session.run(
        'MATCH (t:Town)-[r:HAS_SCHOOL]->(s:School) RETURN t.name AS src_name, s.name AS tgt_name, r.dist_km AS dist_km'
      )
      for r in result:
        links.append({
          'source': f"Town:{r['src_name']}",
          'target': f"School:{r['tgt_name']}",
          'type': 'HAS_SCHOOL',
          'dist_km': r['dist_km'],
        })

      # (Town)-[:IN_REGION]->(Region)
      result = session.run(
        'MATCH (t:Town)-[:IN_REGION]->(reg:Region) RETURN t.name AS src_name, reg.name AS tgt_name'
      )
      for r in result:
        links.append({
          'source': f"Town:{r['src_name']}",
          'target': f"Region:{r['tgt_name']}",
          'type': 'IN_REGION',
        })

      # (Policy)-[:AFFECTED]->(Town)
      result = session.run(
        'MATCH (p:Policy)-[r:AFFECTED]->(t:Town) RETURN p.name AS src_name, t.name AS tgt_name, r.impact AS impact'
      )
      for r in result:
        links.append({
          'source': f"Policy:{r['src_name']}",
          'target': f"Town:{r['tgt_name']}",
          'type': 'AFFECTED',
          'impact': r['impact'],
        })

      # (Rule)-[:APPLIES_TO]->(Town)
      result = session.run(
        'MATCH (rule:Rule)-[:APPLIES_TO]->(t:Town) RETURN rule.id AS src_id, t.name AS tgt_name'
      )
      for r in result:
        links.append({
          'source': f"Rule:{r['src_id']}",
          'target': f"Town:{r['tgt_name']}",
          'type': 'APPLIES_TO',
        })

  except Exception as e:
    return {'nodes': [], 'links': [], 'error': str(e)}

  return {'nodes': nodes, 'links': links}


@router.get('/debug/neo4j-kb')
def debug_neo4j_kb():
  """GET /api/debug/neo4j-kb — export KB for Debug View graph and tables."""
  return get_neo4j_kb_data()


def get_apriori_context(intent: dict) -> str:
  """Get relevant Apriori rules as context."""
  rules = state.rules.get('apriori', [])[:10]
  rule_strs = [
    f"IF {' AND '.join(r['if_conditions'])} → {', '.join(r['then'])} "
    f"(confidence={r['confidence']:.0%}, lift={r['lift']:.2f})"
    for r in rules
  ]
  return 'Pricing patterns from 949k transactions:\n' + '\n'.join(rule_strs)


def get_shap_context() -> str:
  """Top 10 SHAP features as context."""
  top10 = list(state.global_shap.items())[:10]
  lines = [
    f'  {i + 1}. {feat}: avg impact ${val:,.0f}'
    for i, (feat, val) in enumerate(top10)
  ]
  r2 = state.model_meta['test_metrics']['r2']
  return f'Top price drivers (SHAP, Hybrid Cluster Ensemble R²={r2:.4f}):\n' + '\n'.join(lines)


# ── System prompt ─────────────────────────────────────────────────
def _system_prompt() -> str:
  meta = state.model_meta
  test = meta['test_metrics']
  total_tx = meta['train_size'] + meta.get('val_size', 0) + meta['test_size']
  base_models = ', '.join(meta.get('base_models', [])) or 'ensemble bases'
  return f"""You are PropertyLens Assistant — an expert on Singapore HDB resale flat prices.
You help buyers, sellers, and analysts understand HDB resale prices using explainable AI.

Your knowledge comes from:
- {total_tx:,}+ HDB resale transactions
- {meta['model_name']} ({base_models}) with RMSE ${test['rmse']:,.0f}, R² {test['r2']:.4f}, MAPE {test['mape_pct']:.2f}%
- SHAP feature importance analysis
- Apriori association rules
- Neo4j knowledge graph of Singapore towns, MRTs, schools, and policies

Guidelines:
- Be concise and factual. Use Singapore context (SGD, HDB terms, town names).
- When citing prices, always mention they're estimates based on historical data.
- Use **bold** for key figures and town names.
- If asked about a specific flat, suggest using the Buyer view for a precise prediction.
- Always cite your sources at the end using format: Sources: [source1, source2]
- Keep answers under 300 words unless a detailed comparison is requested.
"""


def _build_ollama_messages(req_history: list, user_prompt: str) -> list[dict]:
  messages: list[dict] = [{'role': 'system', 'content': _system_prompt()}]
  for msg in req_history[-6:]:
    role = 'user' if msg.get('role') == 'user' else 'assistant'
    content = (msg.get('content') or '').strip()
    if content:
      messages.append({'role': role, 'content': content})
  messages.append({'role': 'user', 'content': user_prompt})
  return messages


def _build_gemini_history(req_history: list) -> list:
  history = []
  for msg in req_history[-6:]:
    role = 'user' if msg.get('role') == 'user' else 'model'
    history.append({'role': role, 'parts': [msg.get('content', '')]})
  return history


print(
  f'ℹ️ Chat: CHAT_PROVIDER={CHAT_PROVIDER!r} OLLAMA={OLLAMA_BASE_URL!r} '
  f'model={OLLAMA_MODEL!r} gemini_fallback={GEMINI_AVAILABLE}'
)


@router.post('/chat')
def chat(req: ChatRequest):
  intent = extract_intent(req.message)

  # Build context
  context_parts: list[str] = []

  if intent['towns']:
    kg_context = query_neo4j_for_towns(intent['towns'])
    if kg_context:
      context_parts.append(f'[Knowledge Graph]\n{kg_context}')

  if intent['wants_rules'] or intent['wants_price']:
    context_parts.append(f'[Association Rules]\n{get_apriori_context(intent)}')

  if intent['wants_explanation'] or intent['wants_price']:
    context_parts.append(f'[Feature Importance]\n{get_shap_context()}')

  surrogate = state.rules.get('surrogate', [])[:5]
  if surrogate and intent['wants_rules']:
    surr_strs = [
      f"IF {' AND '.join(r['conditions'])} → ~${r['then_price']:,.0f} "
      f"(n={r['samples']:,} transactions)"
      for r in surrogate
    ]
    context_parts.append('[Model Rules (Surrogate Tree)]\n' + '\n'.join(surr_strs))

  context = '\n\n---\n\n'.join(context_parts)

  user_prompt = f"""Context information:
{context}

User question: {req.message}

Answer based on the context above. Be specific about Singapore HDB market."""

  def stream_response():
    sources: list[str] = []
    provider = CHAT_PROVIDER if CHAT_PROVIDER in ('ollama', 'gemini', 'auto') else 'ollama'
    answer_chunks: list[str] = []

    def collect_sources(full_answer: str) -> list[str]:
      s: list[str] = []
      if not full_answer or not context_parts:
        return s
      if '[Knowledge Graph]' in context:
        s.append('Neo4j Knowledge Graph')
      if '[Association Rules]' in context:
        s.append('Apriori rules (949k transactions)')
      if '[Feature Importance]' in context:
        s.append('SHAP global importance')
      if '[Model Rules' in context:
        s.append('Surrogate Decision Tree')
      return s

    try:
      used_ollama = False
      if provider in ('ollama', 'auto'):
        try:
          ollama_messages = _build_ollama_messages(req.history, user_prompt)
          for text in _ollama_chat_stream(ollama_messages):
            answer_chunks.append(text)
            yield _sse_text_chunk(text)
          used_ollama = True
        except Exception as oe:
          print(f'Ollama error: {oe}')
          if provider == 'ollama':
            raise
          answer_chunks.clear()

      if not used_ollama and provider in ('gemini', 'auto'):
        if not GEMINI_AVAILABLE:
          raise RuntimeError('Gemini not configured')
        history = _build_gemini_history(req.history)
        chat_session = gemini.start_chat(history=history)
        response = chat_session.send_message(
          f'{_system_prompt()}\n\n{user_prompt}', stream=True
        )
        for chunk in response:
          text = getattr(chunk, 'text', '') or ''
          if text:
            answer_chunks.append(text)
            yield _sse_text_chunk(text)

      full_answer = ''.join(answer_chunks)
      sources = collect_sources(full_answer)
      if sources:
        sources_frame = json.dumps(sources)
        yield f'data: [SOURCES]{sources_frame}[/SOURCES]\n\n'

      yield 'data: [DONE]\n\n'

    except Exception as e:  # pragma: no cover - runtime failure path
      print(f'Chat LLM error: {e}')
      feature_names = list(state.global_shap.keys()) if state.global_shap else []

      if feature_names:
        top = feature_names[:3]
        if len(top) == 1:
          drivers = f'**{top[0]}**'
        elif len(top) == 2:
          drivers = f'**{top[0]}** and **{top[1]}**'
        else:
          drivers = f'**{top[0]}**, **{top[1]}**, and **{top[2]}**'
        driver_sentence = (
          f'HDB resale prices are primarily driven by {drivers}. '
        )
      else:
        driver_sentence = (
          'HDB resale prices are primarily driven by lease, flat type, and location. '
        )

      fallback = (
        driver_sentence
        + 'Use the Buyer view for a precise prediction with full SHAP explanation.\n\n'
        + '*(AI response unavailable — showing fallback)*'
      )
      yield _sse_text_chunk(fallback)
      yield 'data: [DONE]\n\n'

  return StreamingResponse(stream_response(), media_type='text/event-stream')
