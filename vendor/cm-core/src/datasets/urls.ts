/** Address helpers of the dataset client: path encoding, base resolution and the catalogue address of a repository. */

/** Where the catalogue of the Monodi datasets lives. The tag is fixed so that a change of the catalogue needs a release. */
export const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/corpus-monodicum/monodi-datasets/v1/catalog.json';

/** Percent-encode every segment of a relative path (umlauts, spaces) and keep the slashes. */
export function encodePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * The URL prefix of the data files of a dataset. `base` is the value of `dataset.json`: an absolute URL is used as it
 * is, a relative one (for example `./`) is resolved against the URL of that `dataset.json`. The result ends with `/`.
 */
export function resolveBase(base: string, datasetJsonUrl: string): string {
  const resolved = new URL(base, datasetJsonUrl).href;
  return resolved.endsWith('/') ? resolved : resolved + '/';
}

/** URL of a file of a dataset from its prefix and the path of the index (not yet encoded). */
export function fileUrl(baseUrl: string, relativePath: string): string {
  return baseUrl + encodePath(relativePath);
}

/** Fill the `{name}` placeholders of a file template. A missing value is an error, not an empty string. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (!(name in values)) throw new Error(`The template ${template} needs a value for {${name}}`);
    return values[name];
  });
}

/** The folder of a URL, with a trailing slash (`https://x/a/b.json` gives `https://x/a/`). */
export function folderOf(url: string): string {
  return new URL('./', url).href;
}

/**
 * The catalogue address of a repository typed by a person: `owner/repo`, `owner/repo@ref` or a GitHub link of the
 * repository. Without a ref the default branch (`HEAD`) is read. Returns null if the text is not a repository.
 */
export function catalogUrlForRepository(text: string): string | null {
  let spec = text.trim();
  spec = spec.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_./-]+))?$/.exec(spec);
  if (!match) return null;
  const [, owner, repo, ref] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref ?? 'HEAD'}/catalog.json`;
}
