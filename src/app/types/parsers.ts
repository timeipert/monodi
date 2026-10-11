import * as P from 'parsimmon'
import * as M from './model';
import { v4 as UUID } from "uuid";

export function lineChangeParser(): P.Parser<M.LineChange>{
  return P.regexp(/\| */).result(
    M.emptyLineChange()
  );
}

export function folioChangeParser(): P.Parser<M.FolioChange>{
  return P.regexp(/\|{2} */).result(
    M.emptyFolioChange()
  );
}

export function syllableParser(): P.Parser<M.Syllable>{
  return P.seq(word, P.regexp(/(->?)? */))
    .tie()
    .map<M.Syllable>(makeSyllable);
}

export function referenceParser(): P.Parser<M.Syllable> {
  return reference.map((t) => makeSyllable(t, M.SyllableType.EditorialEllipsis));
}

export function linePartParser(): P.Parser<M.LinePart>{
  return P.alt(
    folioChangeParser(),
    lineChangeParser(),
    syllableParser(),
    referenceParser(),
  );
}

export function folioChangeText(): P.Parser<string> {
  return P.regexp(/\t *\|\| */).then(P.regexp(/[^\n]*/));
}

export function lineContainerParser(): P.Parser<M.ZeileContainer[]>{
  const singleLine = linePartParser().atLeast(1).map<M.ZeileContainer>(lp => ({
    "kind": M.ContainerKind.ZeileContainer,
    uuid: UUID(),
    children: lp
  }));


  return P.seq(
    singleLine.lookahead(P.alt(P.newline, P.eof, folioChangeText())).sepBy1(P.newline),
    folioChangeText().atMost(1),
    P.regexp(/[\t ]*/)
  ).chain(parsed => {
    let folioChange: M.FolioChange | undefined;
    for (let cont of parsed[0]) {
      for (let part of cont.children) {
        if (part.kind === M.LinePartKind.FolioChange) {
          if (folioChange !== undefined) {
            return P.fail("multiple folio changes within one line");
          } else {
            folioChange = part;
          }
        }
      }
    }

    if (folioChange !== undefined && parsed[1].length > 0) {
      folioChange.text = parsed[1][0];
      return P.succeed(parsed[0]);
    } else {
      return P.succeed(parsed[0]);
    }
  });
}

export function paratextParser(): P.Parser<M.FormteilContainer> {
  return P.alt(word, P.string(" ")).atLeast(1).tie().map(makeParatext).skip(folioChangeText().atMost(1));
}

export function makeParatext(text: string): M.FormteilContainer {
  return {
    "kind": M.ContainerKind.FormteilContainer,
    uuid: UUID(),
    children: [
      {
        kind: M.ContainerKind.ParatextContainer,
        uuid: UUID(),
        paratextType: M.ParatextType.Gesang,
        retro: false,
        text: text
      }
    ],
    data: [
      {
        name: M.FormteilDataName.Signatur,
        data: ""
      }
    ]
  };
}

export function makeSyllable(text: string, kind: M.SyllableType = M.SyllableType.Normal): M.Syllable {
  const s = M.emptySyllable();
  s.text = text.trim();
  return s;
}

export const word: P.Parser<string> = P.regex(/[A-Za-z\u00C0-\u017F\.…<>]+[0-9]*/);
export const reference: P.Parser<string> = P.regex(/; *[A-Z]+ *[0-9]+ *(, *[0-9]+)?/)
