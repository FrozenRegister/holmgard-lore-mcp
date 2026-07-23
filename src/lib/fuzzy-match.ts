// Fuzzy matching and scoring for tool/schema discovery
// Used by load_tool_schema to suggest close matches when tool name is misspelled

export interface FuzzyMatch {
  name: string
  score: number
}

/**
 * Levenshtein distance — count minimum edits (insert/delete/substitute) to transform source to target.
 * Lower distance = more similar (0 = exact match).
 */
function levenshteinDistance(source: string, target: string): number {
  const s = source.toLowerCase()
  const t = target.toLowerCase()
  const matrix: number[][] = []

  for (let i = 0; i <= t.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= s.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= t.length; i++) {
    for (let j = 1; j <= s.length; j++) {
      const cost = s[j - 1] === t[i - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j] + 1, // deletion
        matrix[i - 1][j - 1] + cost, // substitution
      )
    }
  }

  return matrix[t.length][s.length]
}

/**
 * Normalize a string for fuzzy matching: remove underscores/hyphens, lowercase.
 * Helps match "list_topics" to "listtopics" or "list-topics".
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[_-]/g, '')
}

/**
 * Score how closely `candidate` matches `query` (0.0–1.0, higher = better match).
 * Uses multiple signals: exact match, normalized match, levenshtein distance, prefix/suffix.
 */
export function scoreMatch(query: string, candidate: string): number {
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()

  // Exact match
  if (q === c) return 1.0

  // Prefix match (e.g., "list" matches "list_topics")
  if (c.startsWith(q)) return 0.95

  // Suffix match (e.g., "topics" matches "list_topics")
  if (c.endsWith(q)) return 0.9

  // Normalized match (underscores/hyphens stripped)
  const qNorm = normalize(q)
  const cNorm = normalize(c)
  if (qNorm === cNorm) return 0.9
  if (cNorm.startsWith(qNorm)) return 0.85
  if (cNorm.includes(qNorm)) return 0.75

  // Levenshtein distance-based score
  // Distance of 1-2 = highly similar, 3-5 = somewhat similar, 6+ = dissimilar
  const distance = levenshteinDistance(q, c)
  const maxLen = Math.max(q.length, c.length)
  const similarity = 1 - distance / (maxLen + 1)

  // Weight by length — shorter queries are fuzzier (more false positives)
  if (q.length <= 3) return Math.max(0, similarity * 0.7)
  if (q.length <= 5) return Math.max(0, similarity * 0.8)
  return Math.max(0, similarity * 0.9)
}

/**
 * Find close matches to `query` from `candidates` (list of tool names).
 * Returns results sorted by score (highest first), above a minimum threshold.
 * @param query Search term
 * @param candidates List of tool/schema names to score
 * @param minScore Minimum score to include (0.0–1.0). Default 0.5.
 * @param limit Maximum results to return. Default 5.
 */
export function findCloseMatches(
  query: string,
  candidates: string[],
  minScore = 0.5,
  limit = 5,
): FuzzyMatch[] {
  return candidates
    .map((name) => ({ name, score: scoreMatch(query, name) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
