export const DEVANAGARI_REGEX = /[\u0900-\u097F]/

export function isDevanagari(text: string): boolean {
  return DEVANAGARI_REGEX.test(text)
}

export function normalizeDevanagari(value: string): string {
  return value.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[़॒॑]/g, '').replace(/\s+/g, ' ').trim()
}

export function normalizeRoman(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[^a-z0-9\s.'-]/g, ' ').replace(/\s+/g, ' ').trim()
}

const INITIAL_VOWELS: Record<string, string> = {
  aa: 'आ', a: 'अ', ee: 'ई', ii: 'ई', i: 'इ', oo: 'ऊ', uu: 'ऊ', u: 'उ', e: 'ए', ai: 'ऐ', o: 'ओ', au: 'औ', ou: 'औ', ri: 'ऋ',
}

const VOWEL_MATRAS: Record<string, string> = {
  aa: 'ा', a: '', ee: 'ी', ii: 'ी', i: 'ि', oo: 'ू', uu: 'ू', u: 'ु', e: 'े', ai: 'ै', o: 'ो', au: 'ौ', ou: 'ौ', ri: 'ृ',
}

const CONSONANTS: Array<[string, string]> = [
  ['shh', 'ष'], ['ssh', 'ष'], ['chh', 'छ'], ['gy', 'ज्ञ'], ['tr', 'त्र'],
  ['kh', 'ख'], ['gh', 'घ'], ['ch', 'च'], ['jh', 'झ'], ['th', 'थ'],
  ['dh', 'ध'], ['ph', 'फ'], ['bh', 'भ'], ['sh', 'श'], ['k', 'क'],
  ['g', 'ग'], ['c', 'क'], ['j', 'ज'], ['t', 'त'], ['d', 'द'],
  ['n', 'न'], ['p', 'प'], ['f', 'फ'], ['b', 'ब'], ['m', 'म'],
  ['y', 'य'], ['r', 'र'], ['l', 'ल'], ['v', 'व'], ['w', 'व'],
  ['s', 'स'], ['h', 'ह'], ['z', 'ज़'], ['q', 'क'], ['x', 'क्स'],
]

const VOWEL_KEYS = ['aa', 'ee', 'ii', 'oo', 'uu', 'ai', 'au', 'ou', 'ri', 'a', 'i', 'u', 'e', 'o']

export function romanWordToDevanagari(word: string): string[] {
  const w = word.toLowerCase()
  if (!w) return []
  type State = { hindi: string; index: number; hadConsonant: boolean }
  let states: State[] = [{ hindi: '', index: 0, hadConsonant: false }]

  while (states.some((s) => s.index < w.length)) {
    const nextStates: State[] = []
    for (const state of states) {
      if (state.index >= w.length) { nextStates.push(state); continue }
      const remaining = w.slice(state.index)
      let matchedVowel = false
      for (const vk of VOWEL_KEYS) {
        if (remaining.startsWith(vk)) {
          matchedVowel = true
          const len = vk.length
          if (!state.hadConsonant) {
            nextStates.push({ hindi: state.hindi + (INITIAL_VOWELS[vk] ?? ''), index: state.index + len, hadConsonant: false })
          } else {
            nextStates.push({ hindi: state.hindi + (VOWEL_MATRAS[vk] ?? ''), index: state.index + len, hadConsonant: false })
            if (vk === 'u') nextStates.push({ hindi: state.hindi + 'ू', index: state.index + len, hadConsonant: false })
            else if (vk === 'i') nextStates.push({ hindi: state.hindi + 'ी', index: state.index + len, hadConsonant: false })
          }
          break
        }
      }
      if (matchedVowel) continue
      let matchedConsonant = false
      for (const [ck, dev] of CONSONANTS) {
        if (remaining.startsWith(ck)) {
          matchedConsonant = true
          const len = ck.length
          nextStates.push({ hindi: state.hindi + dev, index: state.index + len, hadConsonant: true })
          if (ck === 'n') nextStates.push({ hindi: state.hindi + 'ण', index: state.index + len, hadConsonant: true })
          else if (ck === 't') nextStates.push({ hindi: state.hindi + 'ट', index: state.index + len, hadConsonant: true })
          else if (ck === 'd') nextStates.push({ hindi: state.hindi + 'ड', index: state.index + len, hadConsonant: true })
          break
        }
      }
      if (matchedConsonant) continue
      nextStates.push({ hindi: state.hindi + remaining[0], index: state.index + 1, hadConsonant: false })
    }
    const uniqueMap = new Map<string, State>()
    for (const s of nextStates) {
      const key = `${s.index}:${s.hindi}`
      if (!uniqueMap.has(key)) uniqueMap.set(key, s)
      if (uniqueMap.size >= 12) break
    }
    states = Array.from(uniqueMap.values())
  }
  return Array.from(new Set(states.map((s) => s.hindi).filter(Boolean))).slice(0, 4)
}

export function romanToDevanagari(text: string): string[] {
  const words = normalizeRoman(text).split(' ').filter(Boolean)
  if (!words.length) return []
  let phrases: string[] = ['']
  for (const word of words) {
    const candidates = romanWordToDevanagari(word)
    if (!candidates.length) candidates.push(word)
    const nextPhrases: string[] = []
    for (const p of phrases) {
      for (const c of candidates) {
        nextPhrases.push(p ? `${p} ${c}` : c)
      }
    }
    phrases = nextPhrases.slice(0, 6)
  }
  return Array.from(new Set(phrases))
}

const DEVANAGARI_TO_ROMAN_MAP: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v',
  श: 'sh', ष: 'sh', स: 's', ह: 'h', ज़: 'z', फ़: 'f',
}

const MATRA_CHARS = new Set(['ा', 'ि', 'ी', 'ु', 'ू', 'े', 'ै', 'ो', 'ौ'])

export function devanagariToRoman(text: string): string[] {
  const norm = normalizeDevanagari(text)
  if (!norm) return []
  const words = norm.split(' ').filter(Boolean)
  const romanWords: string[] = []

  for (const word of words) {
    let roman = ''
    const chars = Array.from(word)
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]
      const next = chars[i + 1]
      if (c === '्') continue
      const mapped = DEVANAGARI_TO_ROMAN_MAP[c]
      if (!mapped) { if (/^[a-zA-Z0-9]$/.test(c)) roman += c.toLowerCase(); continue }
      if (MATRA_CHARS.has(c)) { roman += mapped; continue }
      if ('अआइईउऊएऐओऔ'.includes(c)) { roman += mapped; continue }
      roman += mapped
      if (!next || next === ' ' || next === '्' || MATRA_CHARS.has(next)) {
        // No inherent 'a'
      } else {
        roman += 'a'
      }
    }
    if (roman) romanWords.push(roman)
  }
  const primary = romanWords.join(' ')
  if (!primary) return []
  const simplified = primary.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a')
  return Array.from(new Set([primary, simplified]))
}

export function getSearchVariants(query: string): string[] {
  const raw = query.trim()
  if (!raw) return []
  const variants = new Set<string>()
  if (isDevanagari(raw)) {
    const norm = normalizeDevanagari(raw)
    if (norm) variants.add(norm)
    devanagariToRoman(raw).forEach((v) => { if (v) variants.add(v) })
  } else {
    const norm = normalizeRoman(raw)
    if (norm) variants.add(norm)
    romanToDevanagari(raw).forEach((v) => { if (v) variants.add(v) })
  }
  return Array.from(variants).filter(Boolean).slice(0, 5)
                }
