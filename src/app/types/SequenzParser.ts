import * as P from 'parsimmon';
import * as PP from './parsers';
import * as M from './model';
import { v4 as UUID } from "uuid";

export function sequenzParser(): P.Parser<M.RootContainer>{
  const rootContainer = M.emptyRootContainer();
  rootContainer.documentType = M.DocumentType.Level2;
  return lineParser().sepBy(P.end.or(P.newline).trim(P.regexp(/ */))).map(lines => {
    rootContainer.children = lines;
    return rootContainer;
  })
}


function singleDoubleLineParser(requiredNumber?: string): P.Parser<[string, string, M.ZeileContainer[]]> {
  if (requiredNumber) {
    return P.seq(
      P.string(requiredNumber),
      P.regexp(/[a-zA-Z]+/).skip(P.string("\t")),
      PP.lineContainerParser()
    );
  } else {
    return P.seq(
      P.regexp(/[0-9]+/),
      P.regexp(/[a-zA-Z]+/).skip(P.string("\t")),
      PP.lineContainerParser()
    );
  }
}

function doubleLineParser():P.Parser<M.FormteilContainer>{
  const complexCase = singleDoubleLineParser().chain(([num, letter, parts]) =>
    P.newline.then(singleDoubleLineParser(num)).map(([_, letter2, parts2]) =>
      makeLinePair(num, [makeLine(letter, parts), makeLine(letter2, parts2)]))
  );

  return P.alt(
    complexCase,
    singleDoubleLineParser().map(([num, letter, parts]) => makeLinePair(num, [makeLine(letter, parts)])),
  );
}

function singleLineParser(): P.Parser<M.FormteilContainer>{
  return P.seqMap(
    P.regexp(/[0-9]+\t/).map(t => t.trim()),
    PP.lineContainerParser(),
    (num, children) => makeLinePair(num, [makeLine("", children)])
  );
}

function lineParser(): P.Parser<M.FormteilContainer>{
  return P.alt(
    doubleLineParser(),
    singleLineParser(),
    PP.paratextParser()
  );
}

function makeLinePair(num: string, children: M.FormteilChildren[]): M.FormteilContainer {
  return {
    "kind": M.ContainerKind.FormteilContainer,
    uuid: UUID(),
    children: children,
    data: [{
      name: M.FormteilDataName.Signatur,
      data: num,
    }]
  };
}

function makeLine(letter: string, children: M.ZeileContainer[]): M.FormteilContainer {
  return {
    "kind": M.ContainerKind.FormteilContainer,
    uuid: UUID(),
    children: children,
    data: [{
      name: M.FormteilDataName.Signatur,
      data: letter
    }]
  }
}
