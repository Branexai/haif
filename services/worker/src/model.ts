import { pipeline, env } from '@huggingface/transformers'
import fs from 'fs'
import path from 'path'

export const MODEL_ID = process.env.MODEL_ID || 'Xenova/TinyLlama-1.1B-Chat-v1.0'
const FALLBACK_MODEL_ID = process.env.FALLBACK_MODEL_ID || 'EleutherAI/gpt-neo-125M'
const MODEL_DTYPE_RAW = (process.env.MODEL_DTYPE || '').toLowerCase()
function getPipelineOpts(modelId: string): any {
  const opts: any = {}
  // Allow explicit dtype via env: fp32 | fp16 | q8
  if (MODEL_DTYPE_RAW === 'fp32' || MODEL_DTYPE_RAW === 'fp16' || MODEL_DTYPE_RAW === 'q8') {
    opts.dtype = MODEL_DTYPE_RAW
  } else if (modelId.toLowerCase().includes('smollm3-3b')) {
    // Default to q8 for SmolLM3-3B on CPU to reduce memory usage
    opts.dtype = 'q8'
  }
  return opts
}

const PIPELINE_CACHE: Record<string, any> = {}

function ensureCacheDir(): string {
  const dir = process.env.TRANSFORMERS_CACHE_DIR || '/data/transformers-cache'
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  try { (env as any).cacheDir = dir } catch {}
  return dir
}

function clearModelCache(modelId: string) {
  try {
    const base = ensureCacheDir()
    const safe = modelId.replace(/[\/]/g, '__')
    const candidate = path.join(base, safe)
    if (fs.existsSync(candidate)) {
      try {
        fs.rmSync(candidate, { recursive: true, force: true })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to remove model-specific cache folder (will switch to fresh cache):', e)
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('Model-specific cache folder not found; will switch to fresh cache without clearing base.')
    }
    // eslint-disable-next-line no-console
    console.warn(`Cleared transformers cache for model: ${modelId}`)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to clear transformers cache:', e)
  }
}

function switchFreshCacheDir(): string {
  const base = ensureCacheDir()
  const fresh = path.join(
    base,
    `retry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  )
  try { fs.mkdirSync(fresh, { recursive: true }) } catch {}
  try { (env as any).cacheDir = fresh } catch {}
  // eslint-disable-next-line no-console
  console.warn(`Switched transformers cache to fresh dir: ${fresh}`)
  return fresh
}

function isLikelyEncoderOnly(id: string): boolean {
  const name = id.toLowerCase()
  const encoderOnlyHints = [
    'bert',
    'roberta', 'xlm-roberta',
    'electra', 'deberta', 'mpnet',
    'longformer', 'flaubert', 'ernie'
  ]
  return encoderOnlyHints.some((hint) => name.includes(hint))
}

function suggestGenerativeAlternatives(): string[] {
  return [
    'Xenova/TinyLlama-1.1B-Chat-v1.0',
    'gpt2',
    'EleutherAI/gpt-neo-125M',
    'Xenova/mistral-7b-instruct (requires suitable hardware)',
    'Xenova/phi-2 (depending on environment)'
  ]
}

function buildFriendlyError(id: string): Error {
  const suggestions = suggestGenerativeAlternatives()
  const messageEn = [
    `Unsupported model for text-generation: "${id}"`,
    'This endpoint requires decoder-only causal language models (generative).',
    `Try one of: ${suggestions.join(', ')}.`,
    'If you need BERT/encoder-only tasks, use pipelines such as fill-mask or text-classification.'
  ].join(' ')

  const messagePt = [
    `Modelo não suportado para geração de texto: "${id}".`,
    'Este endpoint requer modelos causais apenas decodificador (gerativos).',
    `Experimente um destes: ${suggestions.join(', ')}.`,
    'Se precisa de tarefas tipo BERT (encoder-only), use pipelines como fill-mask ou text-classification.'
  ].join(' ')

  return new Error(`${messageEn} | ${messagePt}`)
}

export async function getTextGen(modelId?: string) {
  const id = (modelId && typeof modelId === 'string' && modelId.trim()) ? modelId.trim() : MODEL_ID
  ensureCacheDir()

  // Pre-validate common non-generative families to return a clearer error early
  if (isLikelyEncoderOnly(id)) {
    throw buildFriendlyError(id)
  }

  if (!PIPELINE_CACHE[id]) {
    try {
      PIPELINE_CACHE[id] = await pipeline('text-generation', id, getPipelineOpts(id))
    } catch (err: any) {
      const msg = String(err?.message || err)
      // Wrap known unsupported type errors with a friendly, bilingual message
      if (msg.toLowerCase().includes('unsupported model type') || msg.toLowerCase().includes('not supported')) {
        throw buildFriendlyError(id)
      }
      const lower = msg.toLowerCase()
      const isExternalDataError = (
        lower.includes('getextdatafromtensorproto') ||
        lower.includes('external initializer') ||
        lower.includes('deserialize tensor') ||
        lower.includes('out of bounds')
      )
      if (isExternalDataError) {
        // eslint-disable-next-line no-console
        console.warn('Detected corrupted ONNX external data; switching to fresh cache and retrying:', id)
        // First attempt targeted clear, then switch to a fresh cache dir to avoid EBUSY
        clearModelCache(id)
        switchFreshCacheDir()
        try {
          PIPELINE_CACHE[id] = await pipeline('text-generation', id, getPipelineOpts(id))
        } catch (retryErr: any) {
          // If it still fails after a clean cache, fall back to a known-good model
          // eslint-disable-next-line no-console
          console.warn('Primary model still failing after cache refresh. Falling back to:', FALLBACK_MODEL_ID)
          try {
            PIPELINE_CACHE[FALLBACK_MODEL_ID] = await pipeline('text-generation', FALLBACK_MODEL_ID, getPipelineOpts(FALLBACK_MODEL_ID))
            return PIPELINE_CACHE[FALLBACK_MODEL_ID]
          } catch (fbErr: any) {
            // eslint-disable-next-line no-console
            console.error('Fallback model failed to load:', fbErr)
            throw retryErr
          }
        }
      } else {
        // Otherwise, rethrow the original error
        throw err
      }
    }
  }
  return PIPELINE_CACHE[id]
}