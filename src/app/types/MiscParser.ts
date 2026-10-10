import * as P from 'parsimmon'
import * as PP from './parsers'
import * as M from './model';
import { v4 as UUID } from "uuid";

export function miscParser(): P.Parser<M.RootContainer> {
  const rootContainer = M.emptyRootContainer();
  rootContainer.documentType = M.DocumentType.Level1;
  return partParser().sepBy(P.end.or(P.newline).trim(P.regexp(/ */))).map(lines => {
    rootContainer.children = lines;
    return rootContainer;
  })
}

function partParser(): P.Parser<M.FormteilContainer> {
  return P.alt(
    lineParser(),
    PP.paratextParser()
  );
}

function lineParser(): P.Parser<M.MiscContainer> {
  return P.regex(/[^\t]*\t*/).map(t => t.trim())
    .then(PP.lineContainerParser())
    .map(children => makeLine(children));
}

function makeLine(children: M.ZeileContainer[]): M.MiscContainer {
  return {
    kind: M.ContainerKind.MiscContainer,
    uuid: UUID(),
    children: children,
  }
}

