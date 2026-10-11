import * as P from 'parsimmon'
import * as PP from './parsers'
import * as M from './model';
import { STATUS_TROPE_ELEMENT } from './formteil-status';
import { v4 as UUID } from "uuid";

export function tropusParser(): P.Parser<M.RootContainer>{
  const rootContainer = M.emptyRootContainer();
  rootContainer.documentType = M.DocumentType.Level2;
  return lineParser().sepBy(P.end.or(P.newline).trim(P.regexp(/ */))).map(lines => {
    rootContainer.children = lines;
    return rootContainer;
  })
}

function lineParser(): P.Parser<M.FormteilContainer>{
  return P.alt(
    singleLineParser(),
    PP.paratextParser()
  );
}

function singleLineParser(): P.Parser<M.FormteilContainer>{
  return P.seqMap(
    P.alt(
      P.regexp(/[0-9]+\t/).map(   t => ({name: t.trim(), sType: STATUS_TROPE_ELEMENT })),
      P.regexp(/[a-zA-Z]+\t/).map(t => ({name: t.trim(), sType: "" })),
    ),
    PP.lineContainerParser(),
    (name, children) => makeLine(name.name, name.sType, children)
  );
}

function makeLine(name: string, segmentType: string, lines: M.ZeileContainer[]): M.FormteilContainer {
  return {
    kind: M.ContainerKind.FormteilContainer,
    data:
    [{
      name: M.FormteilDataName.Signatur,
      data: ""
    }].concat(segmentType === "" ? [] : [
      { 
        name: M.FormteilDataName.Status,
        data: segmentType
      }
    ]),
    uuid: UUID(),
    children: [
      {
        kind: M.ContainerKind.FormteilContainer,
        data: [
          {
            name: M.FormteilDataName.Signatur,
            data: ""
          }
        ],
        uuid: UUID(),
        children: lines
      }
    ]
  };
}
