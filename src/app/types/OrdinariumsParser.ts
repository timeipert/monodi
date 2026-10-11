import * as P from 'parsimmon'
import * as PP from './parsers'
import * as M from './model';
import { STATUS_TROPE_ELEMENT } from './formteil-status';
import { v4 as UUID } from "uuid";

export function ordinariumsParser(): P.Parser<M.RootContainer>{
  const rootContainer = M.emptyRootContainer();
  rootContainer.documentType = M.DocumentType.Level2;
  return lineParser().sepBy(P.end.or(P.newline).trim(P.regexp(/ */))).map(lines => {
    rootContainer.children = lines;
    return rootContainer;
  })
}

export function ordinariumRoot(): P.Parser<M.RootContainer> {
  function doParse(data: string): P.Parser<M.RootContainer> {
    const lines = data.split(/\n\r?/)
    const rootContainer = M.emptyRootContainer();
    rootContainer.documentType = M.DocumentType.Level2;

    for (let line of lines) {
      const cont = getLineContinuation(line);
      const last = lastFormteilChildren(rootContainer);

      if (line.match(/^([A-Za-z\u00C0-\u017F\.…<>]+[0-9]*\s*)*$/)) {
        const paratext = makeParatext(line);
        if (last !== undefined) {
          last.push(paratext);
        } else {
          rootContainer.children.push(makeLine("", "", [paratext]));
        }
      } else if (cont !== undefined) {
        if (last === undefined) continue;
        const [lineContainer, folioChangePart ] = parseLineContainer(line);
        last.push(lineContainer);
        if (folioChangePart) {
          fillLastFolioChange(last, folioChangePart);
        }
      } else {
        const [formteil, folioChangePart ] = makeFormteil(line);
        rootContainer.children.push(formteil);
        if (folioChangePart) {
          fillLastFolioChange(formteil.children, folioChangePart);
        }
      }
    }

    return P.succeed(rootContainer);
  }

  return P.takeWhile(x => true).chain(doParse);
}

function fillLastFolioChange(children: M.FormteilChildren[], text: string): boolean {
  for (let child of children.reverse()) {
    if (child.kind === M.ContainerKind.FormteilContainer) {
      const ret = fillLastFolioChange(child.children, text);
      if (ret) return ret;
    }
    if (child.kind === M.ContainerKind.ZeileContainer) {
      for (let linePart of child.children) {
        if (linePart.kind === M.LinePartKind.FolioChange) {
          if (linePart.text === undefined || linePart.text.trim() === "") {
            linePart.text = text;
            return true;
          }
        }
      }
    }
  }

  return false;
}

function parseLineContainer(line: string): [M.ZeileContainer, string | undefined] {
  const [linePart, folioChangePart] = line.split("\t||");
  const spaced = linePart.split(/\s+/);
  const cont: M.ZeileContainer = {
    "kind": M.ContainerKind.ZeileContainer,
    uuid: UUID(),
    children: []
  };

  for (let s of spaced) {
    const split = s.split(/(.*?->?)/).filter(s => s.length > 0);
    for (let part of split) {
      cont.children = cont.children.concat(parseLinePart(part, false));
    }
  }

  return [cont, folioChangePart];
}

function makeFormteil(line: string): [M.FormteilContainer, string | undefined] {
  const tabIndex = line.indexOf("\t");
  if (tabIndex === -1) throw new Error("can't find tab for formteil");
  const beforeTab = line.substring(0, tabIndex);
  const afterTab = line.substring(tabIndex + 1);
  const [lineContainer, folioChangePart] = parseLineContainer(afterTab);

  if (beforeTab.match(/^[1-9]*[IVX]*[a-zA-Z](\^[0–9]+)?$/)) {
    return [makeLine(beforeTab, STATUS_TROPE_ELEMENT, [lineContainer]), folioChangePart];
  } else {
    return [makeLine(beforeTab, "", [lineContainer]), folioChangePart];
  }
}

function parseLinePart(s: string, addMinus: boolean): M.LinePart[] {
  if (s === "|") {
    return [M.emptyLineChange()];
  } else if (s === "||") {
    return [M.emptyFolioChange()];
  } else {
    return [PP.makeSyllable(s + (addMinus ? "-" : ""))];
  }
}

function getLineContinuation(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.indexOf("\t") === -1) return trimmed;
  else if (trimmed.indexOf("||") !== -1 && trimmed.indexOf("||") === trimmed.indexOf("\t") + 1) return trimmed;
  else return undefined;
}

function makeParatext(text: string): M.ParatextContainer {
  return {
    kind: M.ContainerKind.ParatextContainer,
    uuid: UUID(),
    paratextType: M.ParatextType.Gesang,
    retro: false,
    text: text
  };
}

function lastFormteilChildren(root: M.RootContainer | M.FormteilContainer): M.FormteilChildren[] | undefined {
  switch (root.kind) {
      case M.ContainerKind.RootContainer:
        if (root.children.length) {
          const last = root.children[root.children.length - 1];
          if (last.kind === M.ContainerKind.FormteilContainer) {
            return lastFormteilChildren(last);
          } else {
            return undefined;
          }
        } else {
          return undefined;
        }
  }

  return undefined;
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
      P.regexp(/[1-9]*[IVX]*[a-zA-Z](\^[0–9]+)?\t/).map(t => ({name: t.trim(), sType: STATUS_TROPE_ELEMENT })),
      P.regexp(/![^\t]*\t/).map(t => ({name: t.trim(), sType: "" })),
    ),
    PP.lineContainerParser(),
    (name, children) => makeLine(name.name, name.sType, children)
  );
}

function makeLine(name: string, segmentType: string, lines: M.FormteilChildren[]): M.FormteilContainer {
  return {
    kind: M.ContainerKind.FormteilContainer,
    data: [{
      name: M.FormteilDataName.Signatur,
      data: name
    }].concat(segmentType === "" ? [] : [{ 
      name: M.FormteilDataName.Status,
      data: segmentType
    }]),
    uuid: UUID(),
    children: [
      {
        kind: M.ContainerKind.FormteilContainer,
        data: [{
          name: M.FormteilDataName.Signatur,
          data: "",
        }],
        uuid: UUID(),
        children: lines
      }
    ]
  };
}
