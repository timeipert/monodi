/**
 * Display information for the attribute classes of the MEI schema (`MeiAttrDef.group`): a domain
 * (the MEI "domains of a score": logical, gestural, visual, analytical) and a readable name.
 * The class names come from the schema (`att.ncForm`, `att.nc.log`, `att.common`); the labels here are
 * for the browse list and fall back to the class name for classes that are not listed.
 */
export interface GroupInfo {
  /** Section order in the list. */
  order: number;
  domain: string;
  label: string;
}

const NAMES: Record<string, string> = {
  id: 'Identifier', common: 'Common (id, label, n, …)', harmonicFunction: 'Harmonic function', intervalMelodic: 'Melodic interval', melodicFunction: 'Melodic function', neumeType: 'Neume type', pitchClass: 'Pitch class', solfa: 'Solfege', layerIdent: 'Layer', staffIdent: 'Staff', alignment: 'Alignment', staffLoc: 'Staff location', xy: 'Coordinates', accidental: 'Accidental', articulation: 'Articulation', instrumentIdent: 'Instrument', midiVelocity: 'MIDI velocity', pitch: 'Pitch', nc: 'Neume component', basic: 'Basic (id)', labelled: 'Labelling', linking: 'Linking to other elements',
  facsimile: 'Facsimile (zones in an image)', typed: 'Type', responsibility: 'Responsibility', classed: 'Classes', nNumberLike: 'Numbering',
  ncForm: 'Form of the neume component', curvatureDirection: 'Curvature', coordinated: 'Position on the page', typography: 'Typography',
  visibility: 'Visibility', visualOffset: 'Visual offset', color: 'Colour', extSym: 'Symbols (SMuFL)', altSym: 'Alternative symbol',
  edit: 'Editorial', source: 'Source', plist: 'Lists of targets', timestamp: 'Time stamps', startId: 'Start and end ids', cue: 'Cue',
  pitched: 'Pitch', octave: 'Octave', duration: 'Duration'
};

export function groupInfo(group: string | undefined, element: string): GroupInfo {
  if (!group) return { order: 1, domain: 'Specific', label: `Defined on <${element}>` };
  const m = /^(.*)\.(log|ges|vis|anl)$/.exec(group);
  const base = m ? m[1] : group;
  const name = NAMES[base] ?? base.replace(/[.]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  if (m) {
    const dom = { log: ['Logical', 2], ges: ['Gestural', 3], vis: ['Visual', 4], anl: ['Analytical', 5] }[m[2]] as [string, number];
    return { order: dom[1], domain: dom[0], label: `${dom[0]}: ${name}` };
  }
  return { order: ['common', 'basic', 'id'].includes(group) ? 0 : 6, domain: ['common', 'basic', 'id'].includes(group) ? 'Common' : 'General', label: NAMES[base] ?? name };
}
