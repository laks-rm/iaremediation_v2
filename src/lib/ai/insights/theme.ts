import type { ClusterByThemeOptions, ThemeCluster, ThemeClusterInput } from "./types";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "to",
  "was",
  "were",
  "with",
  "within",
]);

const AUDIT_FILLER_PHRASES = [
  "absence of",
  "adequacy of",
  "deficiency in",
  "failure to",
  "gaps in",
  "inadequate",
  "ineffective",
  "insufficient",
  "lack of",
  "missing",
  "not performed",
  "weakness in",
];

const DOMAIN_TERMS = [
  "access review",
  "access rights",
  "business continuity",
  "change management",
  "customer due diligence",
  "data privacy",
  "disaster recovery",
  "due diligence",
  "incident response",
  "information security",
  "logical access",
  "privileged access",
  "regulatory reporting",
  "segregation of duties",
  "service provider",
  "third party",
  "user access",
  "vendor due diligence",
];

function normalizeText(value: string) {
  return AUDIT_FILLER_PHRASES.reduce(
    (text, phrase) => text.replace(new RegExp(`\\b${phrase}\\b`, "gi"), " "),
    value.toLowerCase().replace(/[^a-z0-9\s-]/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function singularize(term: string) {
  if (term.endsWith("ies") && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith("s") && term.length > 4) return term.slice(0, -1);
  return term;
}

export function extractThemeTerms(title: string, description: string | null) {
  const normalized = normalizeText(`${title} ${description ?? ""}`);
  const words = normalized
    .split(/\s+/)
    .map(singularize)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));

  const terms = new Set<string>();
  DOMAIN_TERMS.forEach((term) => {
    if (normalized.includes(term)) terms.add(term);
  });

  words.forEach((word) => terms.add(word));
  for (let index = 0; index < words.length - 1; index += 1) {
    terms.add(`${words[index]} ${words[index + 1]}`);
  }

  return [...terms].filter((term) => term.length > 2);
}

function overlap(left: Set<string>, right: Set<string>) {
  let shared = 0;
  left.forEach((term) => {
    if (right.has(term)) shared += 1;
  });
  return shared;
}

function chooseTheme(terms: string[]) {
  const phrase = terms
    .filter((term) => term.includes(" "))
    .sort((left, right) => right.length - left.length)[0];
  return phrase ?? terms.sort((left, right) => right.length - left.length)[0] ?? "Shared theme";
}

export function clusterByTheme(
  items: ThemeClusterInput[],
  options: ClusterByThemeOptions = {},
): ThemeCluster[] {
  const minItems = options.minItems ?? 3;
  const minSharedTerms = options.minSharedTerms ?? 2;
  const itemTerms = items.map((item) => ({
    item,
    terms: new Set(extractThemeTerms(item.title, item.description)),
  }));
  const visited = new Set<string>();
  const clusters: ThemeCluster[] = [];

  itemTerms.forEach((seed) => {
    if (visited.has(seed.item.findingId)) return;

    const clusterItems = itemTerms.filter(
      (candidate) =>
        candidate.item.findingId === seed.item.findingId ||
        overlap(seed.terms, candidate.terms) >= minSharedTerms,
    );

    if (clusterItems.length < minItems) return;

    const sharedTerms = [...seed.terms].filter((term) =>
      clusterItems.filter((candidate) => candidate.terms.has(term)).length >= minItems,
    );

    clusterItems.forEach((candidate) => visited.add(candidate.item.findingId));
    clusters.push({
      theme: chooseTheme(sharedTerms.length > 0 ? sharedTerms : [...seed.terms]),
      terms: sharedTerms.slice(0, 8),
      items: clusterItems.map((candidate) => candidate.item),
    });
  });

  return clusters.sort((left, right) => right.items.length - left.items.length);
}
