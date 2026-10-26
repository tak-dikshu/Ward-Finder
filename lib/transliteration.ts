// Transliteration engine for Hindi (Devanagari) and English (Romanized) electoral records.
// Supports bidirectional name lookups, Unicode normalization, and phonetic variants.

export const DEVANAGARI_REGEX = /[\u0900-\u097F]/

export function isDevanagari(text: string): boolean {
  return DEVANAGARI_REGEX.test(text)
}

export function normalizeDevanagari(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[़॒॑]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeRoman(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[^a-z0-9\s.'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Independent vowels at the beginning of words/syllables
const INITIAL_VOWELS: Record<string, string> = {
  aa: 'आ',
  a: 'अ',
  ee: 'ई',
  ii: 'ई',
  i: 'इ',
  oo: 'ऊ',
  uu: 'ऊ',
  u: 'उ',
  e: 'ए',
  ai: 'ऐ',
  o: 'ओ',
  au: 'औ',
  ou: 'औ',
  ri: 'ऋ',
}

// Matras attached to preceding consonants
const VOWEL_MATRAS: Record<string, string> = {
  aa: 'ा',
  a: '', // Inherent schwa
  ee: 'ी',
  ii: 'ी',
  i: 'ि',
  oo: 'ू',
  uu: 'ू',
  u: 'ु',
  e: 'े',
  ai: 'ै',
  o: 'ो',
  au: 'ौ',
  ou: 'ौ',
  ri: 'ृ',
}

// Consonants and consonant clusters sorted by longest key first for greedy prefix matching
const CONSONANTS: Array<[string, string]> = [
  ['shh', 'ष'],
  ['ssh', 'ष'],
  ['chh', 'छ'],
  ['shr', 'श्र'],
  ['ksh', 'क्ष'],
  ['shy', 'श्य'],
  ['dhy', 'ध्य'],
  ['gy', 'ज्ञ'],
  ['tr', 'त्र'],
  ['pr', 'प्र'],
  ['kr', 'क्र'],
  ['dr', 'द्र'],
  ['br', 'ब्र'],
  ['gr', 'ग्र'],
  ['vr', 'व्र'],
  ['ty', 'त्य'],
  ['kh', 'ख'],
  ['gh', 'घ'],
  ['ch', 'च'],
  ['jh', 'झ'],
  ['th', 'थ'],
  ['dh', 'ध'],
  ['ph', 'फ'],
  ['bh', 'भ'],
  ['sh', 'श'],
  ['k', 'क'],
  ['g', 'ग'],
  ['c', 'क'],
  ['j', 'ज'],
  ['t', 'त'],
  ['d', 'द'],
  ['n', 'न'],
  ['p', 'प'],
  ['f', 'फ'],
  ['b', 'ब'],
  ['m', 'म'],
  ['y', 'य'],
  ['r', 'र'],
  ['l', 'ल'],
  ['v', 'व'],
  ['w', 'व'],
  ['s', 'स'],
  ['h', 'ह'],
  ['z', 'ज़'],
  ['q', 'क'],
  ['x', 'क्स'],
]

const VOWEL_KEYS = ['aa', 'ee', 'ii', 'oo', 'uu', 'ai', 'au', 'ou', 'ri', 'a', 'i', 'u', 'e', 'o']

// High-frequency Indian electoral names dictionary for 100% precision on common queries
const COMMON_NAME_MAP = new Map<string, string[]>([
  ['prakash', ['प्रकाश']],
  ['ram', ['राम']],
  ['chhotu', ['छोटू', 'छोटु']],
  ['chhatu', ['छोटू']],
  ['raju', ['राजू', 'राजु']],
  ['sonu', ['सोनू', 'सोनु']],
  ['mukesh', ['मुकेश']],
  ['suresh', ['सुरेश']],
  ['ramesh', ['रमेश']],
  ['mahesh', ['महेश']],
  ['dinesh', ['दिनेश']],
  ['sunil', ['सुनील', 'सुनिल']],
  ['anil', ['अनिल']],
  ['amit', ['अमित']],
  ['sumit', ['सुमित']],
  ['pooja', ['पूजा']],
  ['puja', ['पूजा']],
  ['radha', ['राधा']],
  ['rekha', ['रेखा']],
  ['geeta', ['गीता']],
  ['gita', ['गीता']],
  ['anita', ['अनीता', 'अनिता']],
  ['sunita', ['सुनीता', 'सुनिता']],
  ['shyam', ['श्याम']],
  ['sham', ['श्याम']],
  ['lal', ['लाल']],
  ['sharma', ['शर्मा']],
  ['verma', ['वर्मा']],
  ['gupta', ['गुप्ता']],
  ['yadav', ['यादव']],
  ['singh', ['सिंह']],
  ['kumar', ['कुमार']],
  ['kumari', ['कुमारी']],
  ['devi', ['देवी']],
  ['prasad', ['प्रसाद']],
  ['deepak', ['दीपक', 'दिपक']],
  ['dipak', ['दीपक']],
  ['manoj', ['मनोज']],
  ['ajay', ['अजय']],
  ['vijay', ['विजय']],
  ['sanjay', ['संजय']],
  ['vinod', ['विनोद']],
  ['ashok', ['अशोक']],
  ['pawan', ['पवन']],
  ['kamal', ['कमल']],
  ['rajesh', ['राजेश']],
  ['rakesh', ['राकेश']],
  ['om', ['ओम']],
  ['hari', ['हरि']],
  ['babu', ['बाबू', 'बाबु']],
  ['karan', ['करण', 'करन']],
  ['mohan', ['मोहन']],
  ['gopal', ['गोपाल']],
  ['santosh', ['संतोष']],
  ['kailash', ['कैलाश']],
  ['jagdish', ['जगदीश']],
  ['bhagwan', ['भगवान']],
  ['ganesh', ['गणेश']],
  ['govind', ['गोविंद']],
  ['prem', ['प्रेम']],
  ['meena', ['मीना']],
  ['mina', ['मीना']],
  ['jat', ['जाट']],
  ['gurjar', ['गुर्जर']],
  ['saini', ['सैनी']],
  ['choudhary', ['चौधरी']],
  ['chaudhary', ['चौधरी']],
  ['patel', ['पटेल']],
  ['joshi', ['जोशी']],
  ['tiwari', ['तिवारी']],
  ['dubey', ['दुबे']],
  ['mishra', ['मिश्रा']],
  ['pandey', ['पाण्डेय']],
  ['jain', ['जैन']],
  ['agarwal', ['अग्रवाल']],
  ['agrawal', ['अग्रवाल']],
  ['rathore', ['राठौड़']],
  ['chauhan', ['चौहान']],
  ['solanki', ['सोलंकी']],
  ['gehlot', ['गहलोत']],
  ['bairwa', ['बैरवा']],
  ['meghwal', ['मेघवाल']],
  ['rawat', ['रावत']],
  ['khan', ['खान']],
  ['mohammad', ['मोहम्मद']],
  ['mohammed', ['मोहम्मद']],
  ['ali', ['अली']],
])

/**
 * Transliterates a Romanized English word into candidate Devanagari spellings.
 * Handles common Indian naming patterns, consonant clusters, and phonetic variations.
 */
export function romanWordToDevanagari(word: string): string[] {
  const w = word.toLowerCase().trim()
  if (!w) return []

  const directMatches = COMMON_NAME_MAP.get(w) ?? []

  type State = { hindi: string; index: number; hadConsonant: boolean }
  let states: State[] = [{ hindi: '', index: 0, hadConsonant: false }]

  while (states.some((s) => s.index < w.length)) {
    const nextStates: State[] = []

    for (const state of states) {
      if (state.index >= w.length) {
        nextStates.push(state)
        continue
      }

      const remaining = w.slice(state.index)

      // 1. Try vowels first
      let matchedVowel = false
      for (const vk of VOWEL_KEYS) {
        if (remaining.startsWith(vk)) {
          matchedVowel = true
          const len = vk.length

          if (!state.hadConsonant) {
            // Initial independent vowel
            const dev = INITIAL_VOWELS[vk] ?? ''
            nextStates.push({ hindi: state.hindi + dev, index: state.index + len, hadConsonant: false })
          } else {
            // Dependent vowel matra
            if (vk === 'a') {
              if (remaining === 'a') {
                // Word-final 'a' in Indian names (e.g. Radha, Pooja, Rekha, Sharma) is almost always 'ा'
                nextStates.push({ hindi: state.hindi + 'ा', index: state.index + len, hadConsonant: false })
              } else if (w.length <= 4) {
                // Short monosyllabic names (e.g. Ram, Lal, Raj, Das, Pal) use 'ा' as primary
                nextStates.push({ hindi: state.hindi + 'ा', index: state.index + len, hadConsonant: false })
                nextStates.push({ hindi: state.hindi, index: state.index + len, hadConsonant: false })
              } else {
                // Inherent schwa and optional aa matra (e.g. Prakash -> प्रकाश)
                nextStates.push({ hindi: state.hindi + 'ा', index: state.index + len, hadConsonant: false })
                nextStates.push({ hindi: state.hindi, index: state.index + len, hadConsonant: false })
              }
            } else {
              const matra = VOWEL_MATRAS[vk] ?? ''
              nextStates.push({ hindi: state.hindi + matra, index: state.index + len, hadConsonant: false })

              // Common naming variations:
              if (vk === 'u') {
                nextStates.push({ hindi: state.hindi + 'ू', index: state.index + len, hadConsonant: false })
              } else if (vk === 'oo') {
                nextStates.push({ hindi: state.hindi + 'ु', index: state.index + len, hadConsonant: false })
              } else if (vk === 'i') {
                nextStates.push({ hindi: state.hindi + 'ी', index: state.index + len, hadConsonant: false })
              } else if (vk === 'ee') {
                nextStates.push({ hindi: state.hindi + 'ि', index: state.index + len, hadConsonant: false })
              }
            }
          }
          break
        }
      }

      if (matchedVowel) continue

      // 2. Try consonants
      let matchedConsonant = false
      for (const [ck, dev] of CONSONANTS) {
        if (remaining.startsWith(ck)) {
          matchedConsonant = true
          const len = ck.length

          // Retroflex vs dental handling: in nicknames like 'Chhotu', 'Bittu', 'Pintu', 't' before 'u' is 'ट'
          if (ck === 't' && remaining.length > 1 && (remaining[1] === 'u' || remaining[1] === 'o')) {
            nextStates.push({ hindi: state.hindi + 'ट', index: state.index + len, hadConsonant: true })
            nextStates.push({ hindi: state.hindi + 'त', index: state.index + len, hadConsonant: true })
          } else {
            nextStates.push({ hindi: state.hindi + dev, index: state.index + len, hadConsonant: true })
            if (ck === 't') {
              nextStates.push({ hindi: state.hindi + 'ट', index: state.index + len, hadConsonant: true })
            } else if (ck === 'd') {
              nextStates.push({ hindi: state.hindi + 'ड', index: state.index + len, hadConsonant: true })
            } else if (ck === 'n') {
              nextStates.push({ hindi: state.hindi + 'ण', index: state.index + len, hadConsonant: true })
            } else if (ck === 'sh') {
              nextStates.push({ hindi: state.hindi + 'ष', index: state.index + len, hadConsonant: true })
            }
          }

          break
        }
      }

      if (matchedConsonant) continue

      // 3. Fallback for unexpected character
      const ch = remaining[0]
      nextStates.push({ hindi: state.hindi + ch, index: state.index + 1, hadConsonant: false })
    }

    // Deduplicate and bound state explosion
    const uniqueMap = new Map<string, State>()
    for (const s of nextStates) {
      const key = `${s.index}:${s.hindi}`
      if (!uniqueMap.has(key)) uniqueMap.set(key, s)
      if (uniqueMap.size >= 16) break
    }
    states = Array.from(uniqueMap.values())
  }

  const generated = states.map((s) => s.hindi).filter(Boolean)
  const combined = Array.from(new Set([...directMatches, ...generated]))
  return combined.slice(0, 5)
}

/**
 * Transliterates full Romanized text into Devanagari candidate phrases.
 * Supports both multi-word separated ("राम लाल") and compound joined ("रामलाल").
 */
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
    phrases = nextPhrases.slice(0, 8)
  }

  // Also include compound versions for multi-word names (e.g. "राम लाल" -> "रामलाल")
  const results: string[] = []
  for (const p of phrases) {
    results.push(p)
    if (words.length > 1) {
      results.push(p.replace(/\s+/g, ''))
    }
  }

  return Array.from(new Set(results)).slice(0, 6)
}

const DEVANAGARI_TO_ROMAN_MAP: Record<string, string> = {
  // Independent vowels
  अ: 'a',
  आ: 'aa',
  इ: 'i',
  ई: 'ee',
  उ: 'u',
  ऊ: 'oo',
  ऋ: 'ri',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
  // Matras
  'ा': 'aa',
  'ि': 'i',
  'ी': 'ee',
  'ु': 'u',
  'ू': 'oo',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  // Consonants
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  ङ: 'ng',
  च: 'ch',
  छ: 'chh',
  ज: 'j',
  झ: 'jh',
  ञ: 'ny',
  ट: 't',
  ठ: 'th',
  ड: 'd',
  ढ: 'dh',
  ण: 'n',
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  य: 'y',
  र: 'r',
  ल: 'l',
  व: 'v',
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
  ड़: 'd',
  ढ़: 'dh',
  फ़: 'f',
  ज़: 'z',
  // Special
  ज्ञ: 'gy',
  त्र: 'tr',
  क्ष: 'ksh',
  'ं': 'n',
  'ः': 'h',
}

const MATRA_CHARS = new Set(['ा', 'ि', 'ी', 'ु', 'ू', 'ृ', 'े', 'ै', 'ो', 'ौ'])

/**
 * Transliterates Devanagari text into Romanized English words.
 * Correctly applies schwa rules (omits trailing unvocalized 'a' at word endings).
 */
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

      if (c === '्') {
        continue
      }

      const mapped = DEVANAGARI_TO_ROMAN_MAP[c]
      if (!mapped) {
        if (/^[a-zA-Z0-9]$/.test(c)) roman += c.toLowerCase()
        continue
      }

      if (MATRA_CHARS.has(c)) {
        roman += mapped
        continue
      }

      if ('अआइईउऊऋएऐओऔंः'.includes(c)) {
        roman += mapped
        continue
      }

      roman += mapped

      if (!next || next === ' ') {
        // Final consonant: schwa omitted in modern Hindi
      } else if (next === '्') {
        // Halant
      } else if (MATRA_CHARS.has(next)) {
        // Matra follows
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

/**
 * Generates search variants for a query across both Hindi and Romanized forms.
 * Guaranteed to return clean, bounded strings.
 */
export function getSearchVariants(query: string): string[] {
  const raw = query.trim()
  if (!raw) return []

  const variants = new Set<string>()

  if (isDevanagari(raw)) {
    const norm = normalizeDevanagari(raw)
    if (norm) variants.add(norm)
    const romanVariants = devanagariToRoman(raw)
    romanVariants.forEach((v) => {
      if (v) variants.add(v)
    })
  } else {
    const norm = normalizeRoman(raw)
    if (norm) variants.add(norm)
    const devanagariVariants = romanToDevanagari(raw)
    devanagariVariants.forEach((v) => {
      if (v) variants.add(v)
    })
  }

  return Array.from(variants).filter((v) => v.length > 0).slice(0, 6)
                }
