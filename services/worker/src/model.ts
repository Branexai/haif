import { pipeline } from '@huggingface/transformers'

export const MODEL_ID = process.env.MODEL_ID || 'Xenova/tinyllama-1.1b-chat'

const PIPELINE_CACHE: Record<string, any> = {}

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
    'Xenova/tinyllama-1.1b-chat',
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

  // Pre-validate common non-generative families to return a clearer error early
  if (isLikelyEncoderOnly(id)) {
    throw buildFriendlyError(id)
  }

  if (!PIPELINE_CACHE[id]) {
    try {
      PIPELINE_CACHE[id] = await pipeline('text-generation', id)
    } catch (err: any) {
      const msg = String(err?.message || err)
      // Wrap known unsupported type errors with a friendly, bilingual message
      if (msg.toLowerCase().includes('unsupported model type') || msg.toLowerCase().includes('not supported')) {
        throw buildFriendlyError(id)
      }
      // Otherwise, rethrow the original error
      throw err
    }
  }
  return PIPELINE_CACHE[id]
}