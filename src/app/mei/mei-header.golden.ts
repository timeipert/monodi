/**
 * Expected <meiHead> of the Standard level (level 2) for the sample data of mei-header.spec.ts.
 *
 * Validated against the bundled MEI 5.0 schema (src/app/mei/mei-all.rng) with `npm run check:mei-header`.
 * If the header changes on purpose, regenerate this text from the emitter output, run that check, and update
 * CM-hub/docs/METADATA-STANDARDS.md (change log) in the same change.
 */
export const HEADER_LEVEL2_GOLDEN = `<meiHead xmlns="http://www.music-encoding.org/ns/mei" xml:lang="en">
  <fileDesc>
    <titleStmt>
      <title>Ex_1-1v-12</title>
    </titleStmt>
    <editionStmt>
      <edition>ediert</edition>
    </editionStmt>
    <pubStmt>
      <identifier>https://example.org/d/uuid-1</identifier>
      <respStmt>
        <corpName role="publisher">Example Project</corpName>
      </respStmt>
      <address>
        <addrLine>Street 1</addrLine>
        <addrLine>12345 Town</addrLine>
      </address>
      <availability>
        <useRestrict auth.uri="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</useRestrict>
      </availability>
      <date isodate="2026-10-24"/>
    </pubStmt>
    <seriesStmt>
      <title>Example Series</title>
      <respStmt>
        <resp>Project direction</resp>
        <persName>Given Family</persName>
      </respStmt>
      <funder>Example Academy</funder>
    </seriesStmt>
    <notesStmt>
      <annot type="document">A comment.</annot>
      <annot startid="#m-a" endid="#m-b">note</annot>
    </notesStmt>
    <sourceDesc>
      <source xml:id="wit-ex-1">
        <bibl>
          <identifier type="siglum">Ex 1</identifier>
        </bibl>
      </source>
      <source xml:id="wit-wit-a">
        <bibl>
          <identifier type="siglum">Wit A</identifier>
        </bibl>
      </source>
    </sourceDesc>
  </fileDesc>
  <encodingDesc>
    <appInfo>
      <application version="0.9.1">
        <name>Monodi-Zero</name>
      </application>
    </appInfo>
  </encodingDesc>
  <workList>
    <work>
      <identifier>Ex_1-1v-12</identifier>
      <title>Hodie</title>
      <incip>
        <incipText>
          <p>Hodie</p>
        </incipText>
      </incip>
      <contents>
        <contentItem>
          <locus from="1v">f. 1v, l. 12</locus>
        </contentItem>
      </contents>
      <biblList>
        <bibl>AH 47, 12</bibl>
        <bibl type="printed-edition">Edition 1</bibl>
      </biblList>
      <classification>
        <termList>
          <term type="genre">Tropus</term>
          <term type="genre">Introitus-Tropus</term>
          <term type="feast">Nativitas</term>
          <term type="feast">Mass</term>
          <term type="melody">M 7</term>
        </termList>
      </classification>
    </work>
  </workList>
  <manifestationList>
    <manifestation>
      <identifier type="siglum">Ex 1</identifier>
      <identifier type="cantus">X-Ex 1</identifier>
      <titleStmt>
        <title>Ex 1</title>
      </titleStmt>
      <creation>
        <geogName role="origin">Origintown</geogName>
        <geogName role="origin-region">Originland</geogName>
        <corpName role="origin-institution">Example Abbey</corpName>
        <date>13. Jh.</date>
      </creation>
      <langUsage>
        <language xml:lang="la"/>
      </langUsage>
      <biblList type="catalogue-online">
        <bibl>
          <ref target="https://example.org/catalogue">https://example.org/catalogue</ref>
        </bibl>
        <bibl>see also the print catalogue</bibl>
      </biblList>
      <biblList type="catalogue">
        <bibl>Catalogue 1</bibl>
        <bibl>Catalogue 2</bibl>
      </biblList>
      <biblList type="literature">
        <bibl>Study A</bibl>
      </biblList>
      <classification>
        <termList>
          <term type="quellentyp">Graduale</term>
          <term type="ordenstradition">Secular</term>
        </termList>
      </classification>
      <itemList>
        <item>
          <identifier type="shelfmark">Cod. 1</identifier>
          <physLoc>
            <repository>
              <geogName role="settlement">Exampletown</geogName>
              <corpName>Example Library</corpName>
            </repository>
          </physLoc>
        </item>
      </itemList>
      <relationList>
        <relation rel="hasReproduction" target="https://example.org/manifest.json" label="IIIF manifest"/>
        <relation rel="hasReproduction" target="https://example.org/manifest2.json" label="IIIF manifest"/>
      </relationList>
    </manifestation>
  </manifestationList>
  <revisionDesc>
    <change isodate="2026-10-24">
      <changeDesc>
        <p>Exported with Monodi-Zero 0.9.1.</p>
      </changeDesc>
    </change>
  </revisionDesc>
</meiHead>`;
