/**
 * Citable descriptions of the analysis methods: for every method the exact steps, the formulas, the cost and the
 * literature it follows, so that a method section of a paper can be written from it.
 *
 * What it is for: a result of the Analysis page carries the method name and version and the settings used; this file says
 * what the method did with them. It is the text behind the button "How this was computed" and is available as plain text,
 * LaTeX and BibTeX (`methodReport`).
 *
 * Authoritative source: the code of the methods in `methods/` and the helpers they call (`features.ts`, `segments.ts`,
 * `stats.ts`, `cluster.ts`). A description here must be changed together with the code and the `version` of the method;
 * `algorithms.test.ts` checks that every method has a description, that every reference exists and that the settings of a
 * method are named.
 *
 * Markup inside the texts: `[[key]]` is a reference (printed as author and year, or `\cite{key}` in LaTeX); no other markup.
 */
import { getMethod } from './registry';
import type { AnalysisMethod, ParamSpec, ParamValues } from './result';
import type { CorpusFilters } from './filters';

export interface Reference {
  key: string;
  /** Author and year, as it appears inside a sentence. */
  short: string;
  /** The full reference as one line of text. */
  text: string;
  bibtex: string;
}

export interface Formula { name: string; latex: string; plain: string }

export interface AlgorithmDoc {
  /** The steps in the order they are carried out; each is a complete sentence (or two). */
  steps: string[];
  formulas: Formula[];
  /** What the method costs and where it is capped. */
  cost: string;
  /** Keys of `REFERENCES`. */
  references: string[];
}

export const REFERENCES: Record<string, Reference> = {
  dunning1993: {
    key: 'dunning1993', short: 'Dunning 1993',
    text: 'Dunning, Ted (1993): Accurate methods for the statistics of surprise and coincidence. Computational Linguistics 19(1), 61–74.',
    bibtex: '@article{dunning1993,\n  author = {Dunning, Ted},\n  title = {Accurate Methods for the Statistics of Surprise and Coincidence},\n  journal = {Computational Linguistics},\n  volume = {19},\n  number = {1},\n  pages = {61--74},\n  year = {1993}\n}',
  },
  rayson2000: {
    key: 'rayson2000', short: 'Rayson and Garside 2000',
    text: 'Rayson, Paul; Garside, Roger (2000): Comparing corpora using frequency profiling. In: Proceedings of the Workshop on Comparing Corpora, Association for Computational Linguistics, 1–6.',
    bibtex: '@inproceedings{rayson2000,\n  author = {Rayson, Paul and Garside, Roger},\n  title = {Comparing Corpora using Frequency Profiling},\n  booktitle = {Proceedings of the Workshop on Comparing Corpora},\n  publisher = {Association for Computational Linguistics},\n  pages = {1--6},\n  year = {2000}\n}',
  },
  hardie2014: {
    key: 'hardie2014', short: 'Hardie 2014',
    text: 'Hardie, Andrew (2014): Log Ratio – an informal introduction. ESRC Centre for Corpus Approaches to Social Science, Lancaster University. http://cass.lancs.ac.uk/log-ratio-an-informal-introduction/',
    bibtex: '@misc{hardie2014,\n  author = {Hardie, Andrew},\n  title = {Log Ratio -- an informal introduction},\n  howpublished = {ESRC Centre for Corpus Approaches to Social Science (CASS), Lancaster University},\n  url = {http://cass.lancs.ac.uk/log-ratio-an-informal-introduction/},\n  year = {2014}\n}',
  },
  church1990: {
    key: 'church1990', short: 'Church and Hanks 1990',
    text: 'Church, Kenneth Ward; Hanks, Patrick (1990): Word association norms, mutual information, and lexicography. Computational Linguistics 16(1), 22–29.',
    bibtex: '@article{church1990,\n  author = {Church, Kenneth Ward and Hanks, Patrick},\n  title = {Word Association Norms, Mutual Information, and Lexicography},\n  journal = {Computational Linguistics},\n  volume = {16},\n  number = {1},\n  pages = {22--29},\n  year = {1990}\n}',
  },
  rychly2008: {
    key: 'rychly2008', short: 'Rychlý 2008',
    text: 'Rychlý, Pavel (2008): A lexicographer-friendly association score. In: Proceedings of Recent Advances in Slavonic Natural Language Processing (RASLAN 2008), Brno: Masaryk University, 6–9.',
    bibtex: '@inproceedings{rychly2008,\n  author = {Rychl{\\\'y}, Pavel},\n  title = {A Lexicographer-Friendly Association Score},\n  booktitle = {Proceedings of Recent Advances in Slavonic Natural Language Processing (RASLAN 2008)},\n  publisher = {Masaryk University},\n  address = {Brno},\n  pages = {6--9},\n  year = {2008}\n}',
  },
  evert2008: {
    key: 'evert2008', short: 'Evert 2008',
    text: 'Evert, Stefan (2008): Corpora and collocations. In: Lüdeling, Anke; Kytö, Merja (eds.): Corpus Linguistics. An International Handbook, vol. 2. Berlin: Walter de Gruyter, 1212–1248.',
    bibtex: '@incollection{evert2008,\n  author = {Evert, Stefan},\n  title = {Corpora and Collocations},\n  booktitle = {Corpus Linguistics. An International Handbook},\n  editor = {L{\\"u}deling, Anke and Kyt{\\"o}, Merja},\n  volume = {2},\n  publisher = {Walter de Gruyter},\n  address = {Berlin},\n  pages = {1212--1248},\n  year = {2008}\n}',
  },
  burrows2002: {
    key: 'burrows2002', short: 'Burrows 2002',
    text: 'Burrows, John (2002): ‘Delta’: a measure of stylistic difference and a guide to likely authorship. Literary and Linguistic Computing 17(3), 267–287.',
    bibtex: '@article{burrows2002,\n  author = {Burrows, John},\n  title = {{`Delta\'}: a Measure of Stylistic Difference and a Guide to Likely Authorship},\n  journal = {Literary and Linguistic Computing},\n  volume = {17},\n  number = {3},\n  pages = {267--287},\n  year = {2002}\n}',
  },
  sokal1958: {
    key: 'sokal1958', short: 'Sokal and Michener 1958',
    text: 'Sokal, Robert R.; Michener, Charles D. (1958): A statistical method for evaluating systematic relationships. University of Kansas Science Bulletin 38, 1409–1438.',
    bibtex: '@article{sokal1958,\n  author = {Sokal, Robert R. and Michener, Charles D.},\n  title = {A Statistical Method for Evaluating Systematic Relationships},\n  journal = {University of Kansas Science Bulletin},\n  volume = {38},\n  pages = {1409--1438},\n  year = {1958}\n}',
  },
  torgerson1952: {
    key: 'torgerson1952', short: 'Torgerson 1952',
    text: 'Torgerson, Warren S. (1952): Multidimensional scaling: I. Theory and method. Psychometrika 17(4), 401–419.',
    bibtex: '@article{torgerson1952,\n  author = {Torgerson, Warren S.},\n  title = {Multidimensional Scaling: {I}. Theory and Method},\n  journal = {Psychometrika},\n  volume = {17},\n  number = {4},\n  pages = {401--419},\n  year = {1952}\n}',
  },
  gower1966: {
    key: 'gower1966', short: 'Gower 1966',
    text: 'Gower, John C. (1966): Some distance properties of latent root and vector methods used in multivariate analysis. Biometrika 53(3–4), 325–338.',
    bibtex: '@article{gower1966,\n  author = {Gower, John C.},\n  title = {Some Distance Properties of Latent Root and Vector Methods Used in Multivariate Analysis},\n  journal = {Biometrika},\n  volume = {53},\n  number = {3--4},\n  pages = {325--338},\n  year = {1966}\n}',
  },
  levenshtein1966: {
    key: 'levenshtein1966', short: 'Levenshtein 1966',
    text: 'Levenshtein, Vladimir I. (1966): Binary codes capable of correcting deletions, insertions and reversals. Soviet Physics Doklady 10(8), 707–710.',
    bibtex: '@article{levenshtein1966,\n  author = {Levenshtein, Vladimir I.},\n  title = {Binary Codes Capable of Correcting Deletions, Insertions and Reversals},\n  journal = {Soviet Physics Doklady},\n  volume = {10},\n  number = {8},\n  pages = {707--710},\n  year = {1966}\n}',
  },
  ukkonen1985: {
    key: 'ukkonen1985', short: 'Ukkonen 1985',
    text: 'Ukkonen, Esko (1985): Algorithms for approximate string matching. Information and Control 64(1–3), 100–118.',
    bibtex: '@article{ukkonen1985,\n  author = {Ukkonen, Esko},\n  title = {Algorithms for Approximate String Matching},\n  journal = {Information and Control},\n  volume = {64},\n  number = {1--3},\n  pages = {100--118},\n  year = {1985}\n}',
  },
  jaccard1901: {
    key: 'jaccard1901', short: 'Jaccard 1901',
    text: 'Jaccard, Paul (1901): Étude comparative de la distribution florale dans une portion des Alpes et des Jura. Bulletin de la Société Vaudoise des Sciences Naturelles 37, 547–579.',
    bibtex: '@article{jaccard1901,\n  author = {Jaccard, Paul},\n  title = {{\\\'E}tude comparative de la distribution florale dans une portion des Alpes et des Jura},\n  journal = {Bulletin de la Soci{\\\'e}t{\\\'e} Vaudoise des Sciences Naturelles},\n  volume = {37},\n  pages = {547--579},\n  year = {1901}\n}',
  },
  salton1983: {
    key: 'salton1983', short: 'Salton and McGill 1983',
    text: 'Salton, Gerard; McGill, Michael J. (1983): Introduction to Modern Information Retrieval. New York: McGraw-Hill.',
    bibtex: '@book{salton1983,\n  author = {Salton, Gerard and McGill, Michael J.},\n  title = {Introduction to Modern Information Retrieval},\n  publisher = {McGraw-Hill},\n  address = {New York},\n  year = {1983}\n}',
  },
  hiley1993: {
    key: 'hiley1993', short: 'Hiley 1993',
    text: 'Hiley, David (1993): Western Plainchant. A Handbook. Oxford: Clarendon Press.',
    bibtex: '@book{hiley1993,\n  author = {Hiley, David},\n  title = {Western Plainchant. A Handbook},\n  publisher = {Clarendon Press},\n  address = {Oxford},\n  year = {1993}\n}',
  },
  haas2014: {
    key: 'haas2014', short: 'Haas 2014',
    text: 'Haas, Max (2014): ChantDigger (program). Restored source code: https://github.com/timeipert/chantdigger-restored, file public/chantdig_extern.js (functions bildePunkte, bildeIsomorphien, bildeGenaueKontur, bildeKontur).',
    bibtex: '@misc{haas2014,\n  author = {Haas, Max},\n  title = {{ChantDigger}},\n  note = {Program, 2014. Restored source code at \\url{https://github.com/timeipert/chantdigger-restored}, file \\texttt{public/chantdig\\_extern.js}},\n  year = {2014}\n}',
  },
};

/** The software the methods belong to, as a citation (no author names: the project has none for the library). */
export const SOFTWARE_URL = 'https://github.com/timeipert/monodi-platform';
export const SOFTWARE_CITATION = `Monodi-Zero, analysis library @monodi/core/analysis, repository timeipert/monodi-platform (${SOFTWARE_URL})`;

/** Steps shared by every method: how a document becomes a chant and how chants are filtered and grouped. */
export const PREPARATION: AlgorithmDoc = {
  steps: [
    'Reading a chant. The transcription of each document is reduced to one chant: only the first voice is read; latent notes (notes that are implied but not written) are skipped; accidental signs (flat, sharp, natural) are not notes of the melody, are skipped and only counted, so that B and B-flat are not told apart.',
    'Pitch. A note is identified by its diatonic index 7 · octave + step, with the steps C = 0, D = 1, E = 2, F = 3, G = 4, A = 5, B = 6 and the octave numbering of the Monodi data model (the octave starts at C). The index carries letter and octave, no accidental and no absolute frequency. An interval is the difference of two diatonic indexes, in diatonic steps (a repeated note is 0, a third up is +2).',
    'Syllables, neumes, words. All syllables of the text are kept in order, also those without notes. A neume is the group of notes written without a gap (one element of the editor’s structure “spaced”). A word is rebuilt from consecutive syllables when the left one ends with a hyphen or the right one starts with one; it is lower-cased and reduced to letters.',
    'Leaving out. Before any method runs, chants are removed for which a rule matches (the value of a metadata field contains, or equals, a given text, ignoring case), and stop words (a built-in list of Latin function words and further words) are removed from the words of every chant. The rules and stop words are recorded with the result.',
    'Groups. Where a method distinguishes groups, a group is the set of chants with the same value of one metadata field (the source siglum, a genre, any other field, including fields of the Cantus Corpus import); chants without a value form the group “(none)”, and without a field all chants form one group “(all)”. Where a method keeps only the largest groups, they are ordered by the number of chants, largest first, ties alphabetically, and the rest is merged into “(other)”.',
  ],
  formulas: [],
  cost: 'Linear in the number of notes of the corpus.',
  references: [],
};

const NGRAM_TOKENS =
  'Units. A chant is read as a sequence of tokens: pitch (the diatonic index of each note), interval (the difference of each note to the one before, one token fewer than notes), contour (u for a rise, d for a fall, r for a repeat, one token fewer than notes) or word (the words of the text). Chant boundaries are never crossed.';
const WITHIN =
  'Optional restriction. With “only inside one syllable / neume / word”, a window is counted only if its first and its last note lie in the same syllable, neume or word (for pitch tokens the n notes of the window, for interval and contour tokens the n + 1 notes it spans).';

export const ALGORITHMS: Record<string, AlgorithmDoc> = {
  overview: {
    steps: [
      'Group the chants by the chosen field (at most 60 groups).',
      'For each chant count the notes, the syllables (all syllables of the text, also those without notes) and the accidental signs skipped. Count each pitch, each interval between consecutive notes within the chant (values below −8 become −8, above +8 become +8), each syllable with at least one note by its number of notes (more than 12 become 12), and put the chant into a length class by its number of notes: none, 1–49, 50–99, 100–199, 200–299, 300–499, 500–799, 800–1199, 1200 and more.',
      'Draw four histograms (a: chant length, b: pitches, c: intervals, d: notes per syllable). Each axis runs from the lowest to the highest value that occurs, without gaps, so that a missing value shows as an empty column. If the corpus has several groups and more than one group is to be shown, the largest groups (at most as many as set) each get their own series of counts over the same axis; the percentage of a column is its count divided by the sum of that group’s counts over the whole axis, times 100.',
      'Table 1 has one row per group and a row for the whole corpus: chants, notes, syllables, notes per syllable (notes divided by all syllables, two decimals), median notes per chant (the middle value of the sorted numbers of notes, the mean of the two middle values for an even number of chants, one decimal), and the range from the lowest to the highest note of the group.',
      'The caption is assembled from the counts and the group names; the list of the most frequent words counts every occurrence of a word in all chants and lists the most frequent ones.',
    ],
    formulas: [
      { name: 'Share of a column within a group', latex: 'p_{g,k} = 100 \\cdot \\frac{c_{g,k}}{\\sum_{j} c_{g,j}}', plain: 'p(g,k) = 100 · c(g,k) / Σ_j c(g,j), with c(g,k) the count of value k in group g' },
    ],
    cost: 'Linear in the number of notes. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.58 s.',
    references: [],
  },
  'tonal-profile': {
    steps: [
      'Skip chants without notes. For every other chant take the lowest and the highest note (the ambitus is high − low + 1 diatonic steps), the final (the last note) and the tenor (the most frequent pitch; on a tie the pitch whose count reached the maximum first, reading from the start).',
      'Classify every interval of the chant by its size in diatonic steps: 0 is a repeat, 1 a step, 2 or more a leap; per group report the share of each class among all intervals.',
      'Estimate the mode. The final decides the pair of modes: D gives modes 1 and 2, E modes 3 and 4, F modes 5 and 6, G modes 7 and 8; any other final gives no mode. Within the pair, the authentic (odd) mode is chosen if the mean pitch of the chant lies at least two steps above the final, otherwise the plagal (even) mode. The tenor is then compared with the expected tenor of each mode of the pair, as its distance above the final modulo 7: mode 1: 4 (A above D), 2: 2 (F), 3: 5 (C above E), 4: 3 (A), 5: 4 (C above F), 6: 2 (A), 7: 4 (D above G), 8: 3 (C).',
      'Confidence of the estimate: high if exactly one mode of the pair matches the tenor and it is the mode chosen by the position of the melody; low if the one that matches is the other mode (the position decides); medium if the tenor matches neither. Where a chant has a mode in the field “mode” of the data, the share of chants for which the estimate agrees is reported.',
      'Per group the table gives the number of chants, the mean ambitus, the shares of steps, repeats and leaps, and the number of chants per estimated mode.',
    ],
    formulas: [
      { name: 'Ambitus', latex: '\\mathrm{ambitus} = \\max_i p_i - \\min_i p_i + 1', plain: 'ambitus = max(p) − min(p) + 1, with p the diatonic indexes of the notes' },
      { name: 'Position of the melody', latex: '\\bar p - f \\ge 2 \\Rightarrow \\text{authentic}', plain: 'mean(p) − final ≥ 2: authentic mode, otherwise plagal mode' },
    ],
    cost: 'Linear in the number of notes. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.36 s. The estimate is a heuristic for orientation, not a classification: chants that end on A, B or C get no mode, and chants whose tenor differs from the expected one get a low or medium confidence.',
    references: ['hiley1993'],
  },
  variants: {
    steps: [
      'Group the chants by the chosen field (by default the text incipit; the Cantus ID where the corpus has one). Groups are ordered alphabetically; the group “(none)” and groups with fewer chants than the minimum are skipped.',
      'Reduce each chant to its sequence of intervals in diatonic steps, each limited to ±30. Chants with fewer than two notes are skipped. A group with more witnesses than the set limit is cut to its first witnesses in the order of the corpus.',
      'For every pair of witnesses in a group compute the edit distance of the two interval sequences (Levenshtein distance with cost 1 for insertion, deletion and substitution) and divide it by the length of the longer sequence. The distance is 0 for identical sequences and 1 for sequences with nothing in common.',
      'Per group report the mean and the largest distance over all pairs and the witness with the highest mean distance to the others; groups are ranked by mean distance. The table of pairs lists every pair, largest distance first.',
    ],
    formulas: [
      { name: 'Normalised edit distance', latex: 'd(a,b) = \\frac{\\mathrm{lev}(a,b)}{\\max(|a|,|b|)}', plain: 'd(a,b) = lev(a,b) / max(|a|, |b|)' },
    ],
    cost: 'Quadratic in the number of witnesses of a group and in the length of the chants (dynamic programming). Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 8.25 s. The slowest method.',
    references: ['levenshtein1966', 'ukkonen1985'],
  },
  ngrams: {
    steps: [
      NGRAM_TOKENS,
      'Counting. For every n from the smallest to the largest set value, every window of n consecutive tokens of every chant is counted (windows overlap; each position counts). ' + WITHIN,
      'For each distinct n-gram the table gives the count, the count per 10,000 windows of the same length in the whole corpus, the number of chants that contain it and, if a field is chosen, the count in each of the eight largest groups of that field (the rest together as “(other)”). Only n-grams with at least the set minimum count in at least the set minimum number of chants are listed, most frequent first (ties in the order of the pattern text). At most 1,500,000 distinct n-grams are held; further new n-grams are then not counted, and the result says so.',
    ],
    formulas: [
      { name: 'Frequency per 10,000', latex: 'r_w = 10^4 \\cdot \\frac{c_w}{N_n}', plain: 'r(w) = 10000 · c(w) / N(n), with N(n) the number of windows of length n in the corpus' },
    ],
    cost: 'Linear in the number of notes times the number of lengths. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.35 s.',
    references: [],
  },
  keyness: {
    steps: [
      NGRAM_TOKENS,
      'Sides. The target consists of the chants whose value of the chosen field equals the target value (the largest group if none is given); the reference of the chants with the reference value, or, if none is given, of all other chants. Chants of other groups are ignored when a reference value is given.',
      'Counting. As for n-gram frequencies (every window of n tokens, for each n in the range), but separately for the two sides. ' + WITHIN + ' Let a and b be the counts of an item in the target and in the reference, and n1 and n2 the numbers of windows counted on each side. Items with a + b below the set minimum are not tested.',
      'For every item compute the log-likelihood ratio G2 [[dunning1993]] [[rayson2000]] and the log ratio [[hardie2014]]. An item is assigned to the target if its log ratio is at least 0, otherwise to the reference; each list is sorted by G2, largest first. G2 does not carry a sign: the side follows from the log ratio.',
    ],
    formulas: [
      { name: 'Expected frequencies', latex: 'E_1 = \\frac{n_1 (a+b)}{n_1+n_2}, \\qquad E_2 = \\frac{n_2 (a+b)}{n_1+n_2}', plain: 'E1 = n1 (a + b) / (n1 + n2), E2 = n2 (a + b) / (n1 + n2)' },
      { name: 'Log-likelihood ratio', latex: 'G^2 = 2\\left( a \\ln\\frac{a}{E_1} + b \\ln\\frac{b}{E_2} \\right)', plain: 'G2 = 2 (a ln(a / E1) + b ln(b / E2)); a term with a count of 0 is 0' },
      { name: 'Log ratio', latex: '\\mathrm{LR} = \\log_2 \\frac{a / n_1}{b / n_2}', plain: 'LR = log2((a / n1) / (b / n2)); a count of 0 is replaced by 0.5' },
    ],
    cost: 'Linear in the number of windows. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.27 s. G2 = 3.84 corresponds to p < 0.05 and 6.63 to p < 0.01 for one test; many items are tested at once and no correction is applied, so the lists are a ranking, not a proof.',
    references: ['dunning1993', 'rayson2000', 'hardie2014'],
  },
  collocations: {
    steps: [
      'Tokens. Pitches (the diatonic index of each note) or the words of the text of each chant.',
      'Pairs. For every position i of a chant and every k from 1 to the set window, the ordered pair of the token at i and the token at i + k is counted, if i + k lies in the same chant. f is the count of a pair; f(x) is how often x is the first token of a counted pair, f(y) how often y is the second; N is the total number of counted pairs.',
      'Pairs with f below the set minimum are dropped. Each remaining pair gets three association scores: log-Dice [[rychly2008]], pointwise mutual information [[church1990]] and the t-score [[church1990]] (see also [[evert2008]]). The table is sorted by the chosen score, ties by f.',
    ],
    formulas: [
      { name: 'log-Dice', latex: '\\mathrm{logDice} = 14 + \\log_2 \\frac{2 f}{f_x + f_y}', plain: 'logDice = 14 + log2(2 f / (f(x) + f(y)))' },
      { name: 'Pointwise mutual information', latex: '\\mathrm{PMI} = \\log_2 \\frac{f \\cdot N}{f_x \\cdot f_y}', plain: 'PMI = log2(f N / (f(x) f(y)))' },
      { name: 't-score', latex: 't = \\frac{f - f_x f_y / N}{\\sqrt{f}}', plain: 't = (f − f(x) f(y) / N) / √f' },
    ],
    cost: 'Linear in the number of notes times the window; at most 1,500,000 distinct pairs are held. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.71 s.',
    references: ['rychly2008', 'church1990', 'evert2008'],
  },
  'source-distance': {
    steps: [
      NGRAM_TOKENS,
      'Groups. The chants are grouped by the chosen field (values sorted alphabetically); groups with fewer chants than the set minimum are left out, and at most the 400 largest groups are compared. Fewer than three groups give no result.',
      'Features. Every window of n tokens is counted per group and in total. The features are the F most frequent n-grams of the whole compared corpus (ties in the order of the pattern text). The relative frequency of a feature in a group is its count divided by the total number of windows of that group (not only of the features).',
      'Distance. Burrows’ Delta [[burrows2002]]: each feature is z-scored over the groups (mean and sample standard deviation of its relative frequencies; a standard deviation of 0 is replaced by 1), and the distance of two groups is the mean absolute difference of their z-scores. Alternatively one minus the cosine of the frequency vectors [[salton1983]], or one minus the Jaccard index [[jaccard1901]] of the sets of features that occur at least once in each group.',
      'Dendrogram. Average-linkage clustering (UPGMA) [[sokal1958]]: repeatedly the two clusters with the smallest distance are merged (the first such pair in the order of the groups on ties); the distance of the merged cluster to another is the mean of the two distances weighted by the cluster sizes. The leaves are drawn in depth-first order.',
      'Map. Classical multidimensional scaling [[torgerson1952]] [[gower1966]]: the squared distances are double-centred, the two leading eigenvectors are found by power iteration with deflation (start vector sin(i + 1 + 7k) + 0.5, at most 300 iterations, so the result is deterministic), and the coordinates are the eigenvectors times the square roots of their eigenvalues. The axes have no meaning; only the distances in the plane approximate the matrix.',
      'The table of nearest neighbours lists, for each group, the three groups with the smallest distance and the mean distance to all others. The full matrix is stored up to 120 groups.',
    ],
    formulas: [
      { name: 'z-score of a feature', latex: 'z_{g,j} = \\frac{f_{g,j} - \\bar f_j}{s_j}', plain: 'z(g,j) = (f(g,j) − mean_j) / s_j, with s_j the sample standard deviation over the groups' },
      { name: 'Burrows’ Delta', latex: '\\Delta(A,B) = \\frac{1}{F} \\sum_{j=1}^{F} \\left| z_{A,j} - z_{B,j} \\right|', plain: 'Delta(A,B) = (1/F) Σ_j |z(A,j) − z(B,j)|' },
      { name: 'Average linkage', latex: 'd(i \\cup j, k) = \\frac{|i|\\, d(i,k) + |j|\\, d(j,k)}{|i|+|j|}', plain: 'd(i∪j, k) = (|i| d(i,k) + |j| d(j,k)) / (|i| + |j|)' },
    ],
    cost: 'Counting is linear in the number of notes; clustering is cubic and the matrix quadratic in the number of groups (at most 400). Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.69 s. (60 groups).',
    references: ['burrows2002', 'salton1983', 'jaccard1901', 'sokal1958', 'torgerson1952', 'gower1966'],
  },
  segments: {
    steps: [
      'Segmentation. Each chant is cut into segments: by syllable (the notes sung on one syllable, as in ChantDigger [[haas2014]]), by neume, by word, or into groups of n consecutive notes (the last group of a chant may be shorter). Syllables without notes give no segment. Segments do not overlap and follow each other.',
      'Vocabulary. Every distinct sequence of pitches is one segment; segments are numbered in the order of their first occurrence in the corpus, so an id is valid only for this corpus and its order. For each segment the number of occurrences and the number of chants that contain it are counted, and, if a field is chosen, the occurrences in each of the six largest groups (the rest together as “(other)”). Segments with fewer occurrences or fewer notes than the set minimums are not listed.',
      'Similarity. Two segments are similar if the vector of the chosen criterion is equal (criteria after [[haas2014]]). Points: first, last, highest and lowest note. Isomorphism: the differences of successive notes (the same shape, transposed). Shape by intervals: the first difference and each difference at which the direction changes; a repeated note keeps the direction of the movement before it. Shape by shape: the same, with every odd value raised to the next even value (coarser steps). The classes with two or more distinct segments and at least the minimum number of occurrences are listed.',
      'Sequence. If segment ids are given, the chants are listed in which these segments follow each other as consecutive segments, with the number of occurrences, the position of the first and the text there.',
    ],
    formulas: [],
    cost: 'Linear in the number of notes. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.33 s. Deviation from ChantDigger: its running direction for the shape criteria starts as “down”, which lets a repeated note after a first rise count as a turn; here the running direction starts as the direction of the first step.',
    references: ['haas2014'],
  },
  bridges: {
    steps: [
      'Segmentation and vocabulary as for the segments method; the segments of a chant are taken in order (syllables without notes are not segments, so two segments that follow each other may be separated by such a syllable).',
      'Triples. For every position with a segment before and after, the three consecutive segments are Before (B), Nucleus (N) and After (A). The triple is kept if N has at least the set number of notes and the three together have at least the set total. Triples are counted; those with fewer occurrences than the minimum are dropped.',
      'Bridges. A bridge is a pair (B, A) that occurs, among the kept triples, with at least two different nuclei: the same beginning and end with a different melisma between. For each bridge the number of different nuclei, the number of occurrences and the most frequent nuclei are given; bridges are sorted by the number of nuclei, then by occurrences. A second table lists every kept triple.',
    ],
    formulas: [],
    cost: 'Linear in the number of segments. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.27 s.',
    references: ['haas2014'],
  },
  models: {
    steps: [
      'Segmentation and vocabulary as for the segments method. The chants are grouped by the chosen field (all groups; without a field one group); a group with fewer chants than the set number of chants per model is skipped, and a group with more chants than the set limit is cut to its first chants.',
      'Each chant of a group is represented by the set of its distinct segments with at least the set number of notes. An index lists, for every segment, the chants that contain it.',
      'Candidates. For every pair of chants of the group that share at least the set number of segments, the set of shared segments (the intersection of the two sets) is a candidate model; at most 20,000 candidates are examined.',
      'Support. The chants of a candidate are all chants of the group whose set contains every segment of the candidate (found through the segment with the fewest chants). A model is kept if at least the set number of chants support it. A model is a set of segments, not a sequence, and smaller models contained in larger ones with the same chants are listed too. Models are sorted by the number of chants, then by the number of segments.',
    ],
    formulas: [],
    cost: 'Quadratic in the number of chants of a group in the worst case; the slowest of the ChantDigger methods. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 4.80 s.',
    references: ['haas2014'],
  },
  'syllable-groups': {
    steps: [
      'The syllable count of a chant is the number of syllables with non-blank text; if no syllable has text, the number of syllables.',
      'The chants are grouped by the chosen field and, inside each group, by syllable count. Groups of equal syllable count with at least the set number of chants are listed, the largest first, then by the lower syllable count.',
      'For the largest such group (or for the syllable count asked for) the syllables with text of up to 60 of its chants are laid side by side, syllable by syllable, so that equal positions can be compared by eye. The method does not compare the melodies.',
    ],
    formulas: [],
    cost: 'Linear in the number of chants. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.03 s.',
    references: ['haas2014'],
  },
  axis: {
    steps: [
      'Skip chants without notes. The axis of a chant is its N most frequent pitches, most frequent first; on equal counts the lower pitch comes first.',
      'If the order is not distinguished, the axis is the set of these pitches (sorted from low to high); if it is, the ordered list.',
      'Chants with the same axis are counted together. Axes shared by at least the set number of chants are listed, the most shared first, with the counts in each of the eight largest groups of the chosen field (the rest together as “(other)”).',
    ],
    formulas: [],
    cost: 'Linear in the number of notes. Benchmark (synthetic corpus of 22,000 chants with 4.3 million notes, Node, default settings): 0.16 s.',
    references: ['haas2014'],
  },
};

// ── reports ──────────────────────────────────────────────────────────────────

/** Replace `[[key]]` by the short reference (plain text) or by `\cite{key}` (LaTeX). */
function withReferences(s: string, latex: boolean): string {
  return s.replace(/\[\[([a-z0-9]+)\]\]/g, (_, key: string) => {
    const r = REFERENCES[key];
    return latex ? `\\cite{${key}}` : r ? `(${r.short})` : '';
  });
}

const LATEX_CHARS: Record<string, string> = {
  '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
  '≥': '$\\geq$', '≤': '$\\leq$', '±': '$\\pm$', '−': '$-$', '×': '$\\times$', '·': '$\\cdot$', '–': '--', '—': '---', '…': '\\ldots{}', '→': '$\\rightarrow$',
  '‘': '`', '’': "'", '“': '``', '”': "''", '√': '$\\sqrt{}$',
};

/** Escape text for LaTeX (the `\cite{…}` commands made by `withReferences` are kept). */
export function latexEscape(s: string): string {
  const parts = s.split(/(\\cite\{[a-z0-9]+\})/);
  return parts.map((p, i) => (i % 2 === 1 ? p : [...p].map((c) => LATEX_CHARS[c] ?? c).join(''))).join('');
}

/** Names a grouping field by its key (`src:quellensigle` → `Source`); the app knows the labels of the corpus. */
export type FieldLabeller = (key: string) => string | undefined;

function describeValue(spec: ParamSpec, v: number | boolean | string | undefined, label?: FieldLabeller): string {
  if (v === undefined || v === '') return spec.type === 'field' ? 'none' : '(empty)';
  if (spec.type === 'field') return label?.(String(v)) ?? String(v);
  if (spec.type === 'boolean') return v ? 'yes' : 'no';
  if (spec.type === 'select') return spec.options.find((o) => o.value === v)?.label ?? String(v);
  return String(v);
}

/** The settings of a run as `Label: value` pairs, in the order of the method’s parameter list. */
export function settingsOf(method: AnalysisMethod, params: ParamValues, label?: FieldLabeller): { label: string; value: string }[] {
  return method.params.map((spec) => ({ label: spec.label, value: describeValue(spec, params[spec.key], label) }));
}

/** `unknown`: the rules were changed after the result was computed, so the ones used are not known any more. */
function filtersLine(filters: CorpusFilters | undefined | 'unknown'): string {
  if (filters === 'unknown') return 'not recorded (the rules were changed after this result was computed)';
  if (!filters) return 'none';
  const rules = filters.exclude.filter((r) => r.value.trim() !== '').map((r) => `${r.field} ${r.mode} “${r.value}”`);
  const stop = [filters.stopWords.builtIn ? 'built-in Latin list' : '', ...(filters.stopWords.custom.length ? [`${filters.stopWords.custom.length} further word(s)`] : [])].filter(Boolean);
  const parts = [rules.length ? `chants left out where ${rules.join('; ')}` : '', stop.length ? `stop words: ${stop.join(', ')}` : ''].filter(Boolean);
  return parts.length ? parts.join('; ') : 'none';
}

export interface MethodReport {
  title: string;
  /** One-paragraph text with settings, steps, formulas and references. */
  text: string;
  /** The same as a LaTeX fragment (UTF-8, `\cite` keys as in `bibtex`). */
  latex: string;
  /** BibTeX entries of the references used (and of nothing else). */
  bibtex: string;
  references: Reference[];
  settings: { label: string; value: string }[];
}

/**
 * What a method did, for citation: the preparation common to all methods, the steps of the method with the settings used,
 * the formulas, the cost, the references and the software to cite. Returns `null` for an unknown method id.
 */
export function methodReport(methodId: string, params: ParamValues, filters?: CorpusFilters | 'unknown', fieldLabel?: FieldLabeller): MethodReport | null {
  const method = getMethod(methodId);
  const doc = ALGORITHMS[methodId];
  if (!method || !doc) return null;
  const settings = settingsOf(method, params, fieldLabel);
  const keys = [...new Set([...PREPARATION.references, ...doc.references])];
  const references = keys.map((k) => REFERENCES[k]).filter(Boolean);
  const head = `${method.title}, method version ${method.version}`;
  const settingsText = settings.map((s) => `${s.label}: ${s.value}`).join('; ');

  const text = [
    head,
    `Software: ${SOFTWARE_CITATION}; method “${method.id}”, version ${method.version}.`,
    `Settings: ${settingsText || 'none'}.`,
    `Left out: ${filtersLine(filters)}.`,
    '',
    'Preparation of the corpus',
    ...PREPARATION.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Algorithm',
    ...doc.steps.map((s, i) => `${i + 1}. ${withReferences(s, false)}`),
    ...(doc.formulas.length ? ['', 'Formulas', ...doc.formulas.map((f) => `${f.name}: ${f.plain}`)] : []),
    '',
    `Cost and limits: ${withReferences(doc.cost, false)}`,
    ...(references.length ? ['', 'References', ...references.map((r) => r.text)] : []),
  ].join('\n');

  const item = (s: string) => `  \\item ${latexEscape(withReferences(s, true))}`;
  const latex = [
    `\\paragraph{${latexEscape(head)}.}`,
    `Software: ${latexEscape(SOFTWARE_CITATION)}; method \`\`${latexEscape(method.id)}'', version ${method.version}.`,
    `Settings: ${latexEscape(settingsText || 'none')}. Left out: ${latexEscape(filtersLine(filters))}.`,
    '',
    '\\noindent Preparation of the corpus:',
    '\\begin{enumerate}',
    ...PREPARATION.steps.map(item),
    '\\end{enumerate}',
    '',
    '\\noindent Algorithm:',
    '\\begin{enumerate}',
    ...doc.steps.map(item),
    '\\end{enumerate}',
    ...doc.formulas.flatMap((f) => ['', `\\noindent ${latexEscape(f.name)}:`, `\\[ ${f.latex} \\]`]),
    '',
    `\\noindent Cost and limits: ${latexEscape(withReferences(doc.cost, true))}`,
  ].join('\n');

  return { title: head, text, latex, bibtex: references.map((r) => r.bibtex).join('\n\n'), references, settings };
}
