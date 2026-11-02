import { AnnotationTarget, MeiAnnotationRule } from './mei-mapping.model';

const TARGETS: AnnotationTarget[] = ['nc', 'neume', 'syllable'];

function stringMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** Drops malformed rules and unknown fields (settings come from user-editable storage). */
export function sanitizeAnnotationRules(raw: unknown): MeiAnnotationRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MeiAnnotationRule[] = [];
  for (const r of raw as any[]) {
    if (!r || typeof r.id !== 'string' || seen.has(r.id) || !TARGETS.includes(r.target)) continue;
    seen.add(r.id);
    const m = r.match && typeof r.match === 'object' ? r.match : {};
    const match: MeiAnnotationRule['match'] = {};
    if (m.neume && typeof m.neume.text === 'string') {
      match.neume = { text: m.neume.text, mode: m.neume.mode === 'contains' ? 'contains' : 'whole', ignoreShapes: m.neume.ignoreShapes !== false };
    }
    if (m.position && ['first', 'last', 'all', 'nth'].includes(m.position.which)) {
      match.position = { which: m.position.which, ...(m.position.which === 'nth' ? { nth: Math.max(1, Math.floor(Number(m.position.nth) || 1)) } : {}) };
    }
    if (typeof m.syllableText === 'string' && m.syllableText) match.syllableText = m.syllableText;
    if (Array.isArray(m.noteTypes) && m.noteTypes.length > 0) match.noteTypes = m.noteTypes.filter((t: unknown) => typeof t === 'string');
    if (typeof m.pitch === 'string' && m.pitch) match.pitch = m.pitch;
    if (typeof m.liquescent === 'boolean') match.liquescent = m.liquescent;
    if (typeof m.flag === 'string' && m.flag) match.flag = m.flag;
    out.push({
      id: r.id,
      name: typeof r.name === 'string' ? r.name : r.id,
      enabled: r.enabled !== false,
      ...(typeof r.sigle === 'string' && r.sigle ? { sigle: r.sigle } : {}),
      target: r.target,
      match,
      set: stringMap(r.set)
    });
  }
  return out;
}

export function newAnnotationRule(): MeiAnnotationRule {
  return {
    id: 'rule-' + Math.random().toString(36).slice(2, 10),
    name: 'New rule',
    enabled: true,
    target: 'nc',
    match: {},
    set: {}
  };
}
