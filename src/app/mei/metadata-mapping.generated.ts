// GENERATED FILE. Do not edit by hand.
// Source: CM-hub/config/metadata-mapping.yml (spec_version 1), people.csv and roles.csv.
// Regenerate in the CM-hub repository: python -m cmhub.mapping --ts <path to this file>
// Explanation: CM-hub/docs/METADATA-STANDARDS.md
import { MetadataMapping } from './metadata-mapping.model';

export const METADATA_MAPPING: MetadataMapping = {
  "specVersion": 1,
  "meiVersion": "5.0",
  "levels": {
    "1": "Minimal: equals the baseline (MEI export of Monodi-Zero 0.9.1): title, siglum, comment, genre",
    "2": "Standard: schema-conformant header with publisher, licence, source, folio",
    "3": "Extended: authority IDs, normalized dating, table of contents"
  },
  "aliases": {
    "work": "workList/work",
    "source": "fileDesc/sourceDesc/source",
    "manifestation": "manifestationList/manifestation"
  },
  "project": {
    "publisher": "Corpus Monodicum",
    "address": [
      "Domerschulstraße 13",
      "97070 Würzburg"
    ],
    "country": "Germany",
    "funderName": "Akademie der Wissenschaften und der Literatur Mainz",
    "seriesTitle": "Corpus Monodicum",
    "documentBaseUri": "https://corpus-monodicum.de/d/",
    "language": "en",
    "licenseUri": "",
    "licenseLabel": ""
  },
  "entries": [
    {
      "id": "src.siglum",
      "entity": "source",
      "monodi": [
        "quellensigle"
      ],
      "cm": [
        "Quellensigle"
      ],
      "targets": [
        {
          "path": "{source}/bibl/identifier[@type='siglum']",
          "level": 1
        },
        {
          "path": "{manifestation}/titleStmt/title",
          "level": 2
        }
      ],
      "level": 1,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "src.library",
      "entity": "source",
      "monodi": [
        "bibliothek"
      ],
      "cm": [
        "Bibliothek"
      ],
      "targets": [
        {
          "path": "{manifestation}/itemList/item/physLoc/repository/corpName",
          "level": 2
        }
      ],
      "level": 1,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "src.shelfmark",
      "entity": "source",
      "monodi": [
        "bibliothekssignatur"
      ],
      "cm": [
        "Bibliothessignatur"
      ],
      "targets": [
        {
          "path": "{manifestation}/itemList/item/identifier[@type='shelfmark']",
          "level": 2
        }
      ],
      "level": 1,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "src.date_text",
      "entity": "source",
      "monodi": [
        "datierung"
      ],
      "cm": [
        "Datierung raw"
      ],
      "targets": [
        {
          "path": "{manifestation}/creation/date",
          "level": 2
        }
      ],
      "level": 1,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "src.date_normalized",
      "entity": "source",
      "monodi": [],
      "cm": [
        "Datierung",
        "Jahrhundert",
        "cantus_century"
      ],
      "targets": [
        {
          "path": "{manifestation}/creation/date/@notbefore",
          "level": 2
        },
        {
          "path": "{manifestation}/creation/date/@notafter",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.id",
      "entity": "document",
      "monodi": [
        "dokumenten_id"
      ],
      "cm": [
        "Dokumenten_ID"
      ],
      "targets": [
        {
          "path": "fileDesc/titleStmt/title",
          "level": 1
        },
        {
          "path": "{work}/identifier",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": true,
      "verify": false
    },
    {
      "id": "doc.uuid",
      "entity": "document",
      "monodi": [
        "id"
      ],
      "cm": [
        "Doc-Id' (intern)"
      ],
      "targets": [
        {
          "path": "fileDesc/pubStmt/identifier",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.incipit",
      "entity": "document",
      "monodi": [
        "textinitium"
      ],
      "cm": [
        "Textinitium Editionseinheit"
      ],
      "targets": [
        {
          "path": "{work}/title",
          "level": 1
        },
        {
          "path": "{work}/incip/incipText/p",
          "level": 2
        }
      ],
      "level": 1,
      "inBaseline": true,
      "verify": false
    },
    {
      "id": "doc.incipit_addition",
      "entity": "document",
      "monodi": [],
      "cm": [
        "Zusatz zu Textinitium"
      ],
      "targets": [
        {
          "path": "{work}/title[@type='alternative']",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.genre",
      "entity": "document",
      "monodi": [
        "gattung1",
        "gattung2"
      ],
      "cm": [
        "Gattung1",
        "Gattung2"
      ],
      "targets": [
        {
          "path": "{work}/classification/termList/term[@type='genre']",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": true,
      "verify": false
    },
    {
      "id": "doc.feast",
      "entity": "document",
      "monodi": [
        "festtag",
        "feier"
      ],
      "cm": [
        "Fest",
        "Feier"
      ],
      "targets": [
        {
          "path": "{work}/classification/termList/term[@type='feast']",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": true,
      "verify": false
    },
    {
      "id": "doc.vocabularies",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "encodingDesc/classDecls/taxonomy/category",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.folio",
      "entity": "document",
      "monodi": [
        "foliostart",
        "zeilenstart"
      ],
      "cm": [
        "Startseite",
        "Start Verso-Spalte",
        "Startzeile",
        "Startposition",
        "Endseite",
        "End Verso-Spalte",
        "Endzeile"
      ],
      "targets": [
        {
          "path": "{work}/contents/contentItem/locus",
          "level": 2
        },
        {
          "path": "{work}/contents/contentItem/locus/@from",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.bibl_ref",
      "entity": "document",
      "monodi": [
        "bibliographischerverweis"
      ],
      "cm": [],
      "targets": [
        {
          "path": "{work}/biblList/bibl",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.text_reference",
      "entity": "document",
      "monodi": [],
      "cm": [
        "Nachweis_Editionseinheit"
      ],
      "targets": [
        {
          "path": "{work}/biblList/bibl[@type='text-reference']",
          "level": 3
        }
      ],
      "level": 3,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.print_edition",
      "entity": "document",
      "monodi": [
        "druckausgabe"
      ],
      "cm": [
        "Druckausgabe"
      ],
      "targets": [
        {
          "path": "{work}/biblList/bibl[@type='printed-edition']",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.comment",
      "entity": "document",
      "monodi": [
        "kommentar"
      ],
      "cm": [
        "Kommentar"
      ],
      "targets": [
        {
          "path": "fileDesc/notesStmt/annot[@type='document']",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": true,
      "verify": false
    },
    {
      "id": "doc.critical_comments",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "fileDesc/notesStmt/annot[@startid][@endid]",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": true,
      "verify": false
    },
    {
      "id": "doc.edition_status",
      "entity": "document",
      "monodi": [
        "editionsstatus"
      ],
      "cm": [
        "Editionsstatus"
      ],
      "targets": [
        {
          "path": "fileDesc/editionStmt/edition",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.source_ref",
      "entity": "document",
      "monodi": [
        "quelle_id"
      ],
      "cm": [
        "Quellen-ID (intern)",
        "Quellensigle"
      ],
      "targets": [
        {
          "path": "{source}/@xml:id",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": true,
      "verify": false
    },
    {
      "id": "doc.source_link",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "{source}/relatedItem",
          "level": 3
        }
      ],
      "level": 3,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.witnesses",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "{source}",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": true,
      "verify": false
    },
    {
      "id": "doc.relations",
      "entity": "document",
      "monodi": [],
      "cm": [
        "Bezugsgesang"
      ],
      "targets": [
        {
          "path": "{work}/relationList/relation",
          "level": 3
        }
      ],
      "level": 3,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.subcorpus",
      "entity": "document",
      "monodi": [],
      "cm": [
        "subcorpus"
      ],
      "targets": [
        {
          "path": "{work}/classification/termList/term[@type='subcorpus']",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.custom",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "{work}/classification/termList/term[@type]",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.cantus",
      "entity": "document",
      "monodi": [],
      "cm": [
        "Cantus_ID",
        "Cantus_Melody_ID",
        "Cantus_Genre"
      ],
      "targets": [
        {
          "path": "{work}/identifier[@type='cantus-id']",
          "level": 3
        },
        {
          "path": "{work}/classification/termList/term[@type='genre'][@auth='Cantus Index']",
          "level": 3
        }
      ],
      "level": 3,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.hub_extra",
      "entity": "document",
      "monodi": [],
      "cm": [
        "Melodie Standard",
        "Melodie Quelle",
        "Melodiennummer_Katalog",
        "Referenz auf Spiel",
        "SpielName",
        "Überlieferungszustand",
        "Nachtragsschicht"
      ],
      "targets": [
        {
          "path": "{work}/classification/termList/term[@type]",
          "level": 3
        }
      ],
      "level": 3,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.iiif",
      "entity": "document",
      "monodi": [],
      "cm": [
        "IIIFs"
      ],
      "targets": [
        {
          "path": "{manifestation}/itemList/item/ptr[@type='iiif']",
          "level": 3
        }
      ],
      "level": 3,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.facsimile",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "/mei/music/facsimile/surface/graphic/@target",
          "level": 3
        }
      ],
      "level": 3,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.editor",
      "entity": "document",
      "monodi": [],
      "cm": [
        "Editor"
      ],
      "targets": [
        {
          "path": "fileDesc/titleStmt/respStmt/persName",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": true
    },
    {
      "id": "doc.project_credits",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "fileDesc/seriesStmt/respStmt",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.publication",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "fileDesc/pubStmt/respStmt/corpName",
          "level": 1
        },
        {
          "path": "fileDesc/pubStmt/address",
          "level": 1
        },
        {
          "path": "fileDesc/pubStmt/availability/useRestrict",
          "level": 1
        },
        {
          "path": "fileDesc/pubStmt/date/@isodate",
          "level": 1
        },
        {
          "path": "fileDesc/seriesStmt/funder",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.encoding",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "encodingDesc/appInfo/application",
          "level": 2
        },
        {
          "path": "encodingDesc/editorialDecl/p",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.lang",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "@xml:lang",
          "level": 1
        }
      ],
      "level": 1,
      "inBaseline": false,
      "verify": false
    },
    {
      "id": "doc.revision",
      "entity": "document",
      "monodi": [],
      "cm": [],
      "targets": [
        {
          "path": "revisionDesc/change",
          "level": 2
        }
      ],
      "level": 2,
      "inBaseline": false,
      "verify": false
    }
  ],
  "roles": [
    {
      "id": "edition",
      "labelEn": "edition",
      "labelDe": "Edition",
      "marc": "edt",
      "respText": "Edition",
      "levels": [
        "document",
        "corpus"
      ]
    },
    {
      "id": "text-edition",
      "labelEn": "text edition",
      "labelDe": "Textedition",
      "marc": "edt",
      "respText": "Text edition",
      "levels": [
        "document",
        "corpus"
      ]
    },
    {
      "id": "text-revision",
      "labelEn": "text revision",
      "labelDe": "Textrevision",
      "marc": "pfr",
      "respText": "Text revision",
      "levels": [
        "document",
        "corpus"
      ]
    },
    {
      "id": "assistance",
      "labelEn": "assistance",
      "labelDe": "Mitarbeit",
      "marc": "ctb",
      "respText": "Assistance",
      "levels": [
        "corpus"
      ]
    },
    {
      "id": "manuscript-descriptions",
      "labelEn": "manuscript descriptions",
      "labelDe": "Quellenbeschreibungen",
      "marc": "",
      "respText": "Manuscript description",
      "levels": [
        "source",
        "corpus"
      ]
    },
    {
      "id": "software-development",
      "labelEn": "software development",
      "labelDe": "Softwareentwicklung",
      "marc": "prg",
      "respText": "Software development",
      "levels": [
        "corpus"
      ]
    },
    {
      "id": "data-modelling",
      "labelEn": "data modelling",
      "labelDe": "Datenmodellierung",
      "marc": "dtm",
      "respText": "Data modelling",
      "levels": [
        "corpus"
      ]
    },
    {
      "id": "project-direction",
      "labelEn": "project direction",
      "labelDe": "Projektleitung",
      "marc": "pdr",
      "respText": "Project direction",
      "levels": [
        "corpus"
      ]
    },
    {
      "id": "project-management",
      "labelEn": "project management",
      "labelDe": "Projektmanagement",
      "marc": "pmn",
      "respText": "Project management",
      "levels": [
        "corpus"
      ]
    }
  ],
  "people": [
    {
      "id": "atkinson-charles-m",
      "display": "Charles M. Atkinson",
      "sort": "Atkinson, Charles M.",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "behl-michael",
      "display": "Michael Behl",
      "sort": "Behl, Michael",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "bjoerkvall-gunilla",
      "display": "Gunilla Björkvall",
      "sort": "Björkvall, Gunilla",
      "roles": [
        "text-edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "brusa-gionata",
      "display": "Gionata Brusa",
      "sort": "Brusa, Gionata",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "catalunya-david",
      "display": "David Catalunya",
      "sort": "Catalunya, David",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "dorofeev-maria",
      "display": "Maria Dorofeev",
      "sort": "Dorofeev, Maria",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "eipert-tim",
      "display": "Tim Eipert",
      "sort": "Eipert, Tim",
      "roles": [
        "data-modelling",
        "software-development"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "haug-andreas",
      "display": "Andreas Haug",
      "sort": "Haug, Andreas",
      "roles": [
        "project-direction"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "hartelt-alexander",
      "display": "Alexander Hartelt",
      "sort": "Hartelt, Alexander",
      "roles": [
        "software-development"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "hartmann-strauss-jasmin",
      "display": "Jasmin Hartmann-Strauß",
      "sort": "Hartmann-Strauß, Jasmin",
      "roles": [
        "edition",
        "manuscript-descriptions"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "hiley-david",
      "display": "David Hiley",
      "sort": "Hiley, David",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "iversen-gunilla",
      "display": "Gunilla Iversen",
      "sort": "Iversen, Gunilla",
      "roles": [
        "text-revision"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "jacobsson-ritva-maria",
      "display": "Ritva Maria Jacobsson",
      "sort": "Jacobsson, Ritva Maria",
      "roles": [
        "text-revision"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "klaper-michael",
      "display": "Michael Klaper",
      "sort": "Klaper, Michael",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "kloeckener-monnica",
      "display": "Monnica Klöckener",
      "sort": "Klöckener, Monnica",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "kolb-patricia",
      "display": "Patricia Kolb",
      "sort": "Kolb, Patricia",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "kraft-isabel",
      "display": "Isabel Kraft",
      "sort": "Kraft, Isabel",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "krosse-malte",
      "display": "Malte Krosse",
      "sort": "Krosse, Malte",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "landerkin-kelly",
      "display": "Kelly Landerkin",
      "sort": "Landerkin, Kelly",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "lein-margarete",
      "display": "Margarete Lein",
      "sort": "Lein, Margarete",
      "roles": [
        "project-management"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "lindenmann-iris",
      "display": "Iris Lindenmann",
      "sort": "Lindenmann, Iris",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "maraqa-salah-eddin",
      "display": "Salah Eddin Maraqa",
      "sort": "Maraqa, Salah Eddin",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "morawietz-stefanie",
      "display": "Stefanie Morawietz",
      "sort": "Morawietz, Stefanie",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "pfisterer-andreas",
      "display": "Andreas Pfisterer",
      "sort": "Pfisterer, Andreas",
      "roles": [
        "edition",
        "manuscript-descriptions",
        "text-revision"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "poeppel-felix",
      "display": "Felix Pöppel",
      "sort": "Pöppel, Felix",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "puppe-frank",
      "display": "Frank Puppe",
      "sort": "Puppe, Frank",
      "roles": [
        "project-direction"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "sanda-anna",
      "display": "Anna Sanda",
      "sort": "Sanda, Anna",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "schlotterbeck-jasmin",
      "display": "Jasmin Schlotterbeck",
      "sort": "Schlotterbeck, Jasmin",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "schuppe-johann-c",
      "display": "Johann C. Schuppe",
      "sort": "Schuppe, Johann C.",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "scotti-alba",
      "display": "Alba Scotti",
      "sort": "Scotti, Alba",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "stickler-felicitas",
      "display": "Felicitas Stickler",
      "sort": "Stickler, Felicitas",
      "roles": [
        "assistance"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "stratton-hild-elaine",
      "display": "Elaine Stratton Hild",
      "sort": "Stratton Hild, Elaine",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "swientek-lucia",
      "display": "Lucia Swientek",
      "sort": "Swientek, Lucia",
      "roles": [
        "assistance",
        "manuscript-descriptions"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "voigt-konstantin",
      "display": "Konstantin Voigt",
      "sort": "Voigt, Konstantin",
      "roles": [
        "edition"
      ],
      "orcid": "",
      "gnd": ""
    },
    {
      "id": "zuehlke-hanna",
      "display": "Hanna Zühlke",
      "sort": "Zühlke, Hanna",
      "roles": [
        "manuscript-descriptions"
      ],
      "orcid": "",
      "gnd": ""
    }
  ]
};
