/**
 * The two trial files for a two-voice case (neume and premensural encoding of the same five syllables, "Mi-ro-ge-ne-re"), as received
 * from a colleague on 2026-11-05. They are kept verbatim so that `mei-presets.spec.ts` can compare the export of the two presets with them.
 * Known differences between the export and the files are listed in that spec.
 */

export const TRIAL_NEUMES_XML = `<?xml version='1.0' encoding='UTF-8'?>
<?xml-model href="https://music-encoding.org/schema/5.0/mei-Neumes.rng" name="application/xml" schemanamens="http://relaxng.org/ns/structure/1.0"?>
<?xml-model href="https://music-encoding.org/schema/5.0/mei-Neumes.rng" name="application/xml" schemanamens="http://purl.oclc.org/dsdl/schematron"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" xmlns:xlink="http://www.w3.org/1999/xlink"
    xml:id="m-1" meiversion="5.0">
    <meiHead xml:id="m-2">
        <fileDesc xml:id="m-3">
            <titleStmt xml:id="m-4">
                <title xml:id="m-14">trial</title>
            </titleStmt>
            <pubStmt xml:id="m-18"/>
        </fileDesc>
    </meiHead>
    <music xml:id="m-22">
        <body xml:id="m-23">
            <mdiv xml:id="m-24">
                <score xml:id="m-26">
                    <scoreDef xml:id="m-27">
                        <staffGrp xml:id="m-28">
                            <staffGrp xml:id="m-41" n="1" symbol="bracket">
                                <staffDef xml:id="m-29" clef.line="2" clef.shape="G" lines="5" n="1"
                                    notationtype="neume">
                                    <label xml:id="m-30">iii [triplum]</label>
                                </staffDef>
                                <staffDef xml:id="m-33" clef.line="2" clef.shape="G" lines="5" n="2"
                                    notationtype="neume">
                                    <label xml:id="m-34">[duplum]</label>
                                </staffDef>
                            </staffGrp>
                        </staffGrp>
                    </scoreDef>
                    <section xml:id="m-42">
                        <staff n="1">
                            <layer n="1">
                                <!-- 1st syllable -->
                                <syllable>
                                    <syl sameas="#syl001"/>
                                    <neume xml:id="n001">
                                        <nc pname="f" oct="5" name="virga"/>
                                        <nc pname="e" oct="5" name="punctum"/>
                                        <nc pname="d" oct="5" name="punctum"/>
                                    </neume>
                                </syllable>
                                <!-- 2nd syllable -->
                                <syllable>
                                    <syl sameas="#syl002"/>
                                    <neume xml:id="n002">
                                        <nc pname="c" oct="5" name="virga"/>
                                    </neume>
                                </syllable>
                                <!-- 3rd syllable -->
                                <syllable>
                                    <syl sameas="#syl003"/>
                                    <neume xml:id="n003">
                                        <nc pname="c" oct="5" name="punctum"/>
                                    </neume>
                                </syllable>
                                <!-- 4th syllable -->
                                <syllable>
                                    <syl sameas="#syl004"/>
                                    <neume xml:id="n004"><!-- this is a bistropha -->
                                        <nc pname="a" oct="4" name="punctum"/>
                                        <nc pname="a" oct="4" name="virga"/>
                                    </neume>
                                </syllable>
                                <!-- 5th syllable -->
                                <syllable>
                                    <syl sameas="#syl005"/>
                                    <neume xml:id="n006">
                                        <nc pname="a" oct="4" name="virga"/>
                                    </neume>
                                </syllable>
                            </layer>
                        </staff>
                        <staff n="2">
                            <layer n="1">
                                <!-- 1st syllable -->
                                <syllable>
                                    <syl xml:id="syl001">Mi-</syl>
                                    <neume synch="#n001">
                                        <nc pname="f" oct="4"/>
                                        <nc pname="g" oct="4"/>
                                    </neume>                                   
                                </syllable>
                                <!-- 2nd syllable -->
                                <syllable>
                                    <syl xml:id="syl002">ro</syl>
                                    <neume synch="#n002">
                                        <nc  pname="a" oct="4" name="virga"/>
                                    </neume>
                                </syllable>
                                <!-- 3rd syllable -->
                                <syllable>
                                    <syl xml:id="syl003">ge</syl>
                                    <neume synch="#n003">
                                        <nc pname="a" oct="4" name="punctum"/>
                                    </neume>
                                </syllable>
                                <!-- 4th syllable -->
                                <syllable>
                                    <syl xml:id="syl004">ne</syl>
                                    <neume synch="#n004">
                                        <nc pname="a" oct="4" name="punctum"/>
                                    </neume>
                                </syllable>
                                <!-- 5h syllable -->
                                <syllable>
                                    <syl xml:id="syl005">re</syl>
                                    <neume synch="#n006">
                                        <nc  pname="a" oct="4" name="punctum"/>
                                    </neume>
                                </syllable>
                            </layer>
                        </staff>
                    </section>
                </score>
            </mdiv>
        </body>
    </music>
</mei>`;

export const TRIAL_PREMENSURAL_XML = `<?xml version='1.0' encoding='UTF-8'?>
<?xml-model href="https://music-encoding.org/schema/5.0/mei-Mensural.rng" name="application/xml" schemanamens="http://relaxng.org/ns/structure/1.0"?>
<?xml-model href="https://music-encoding.org/schema/5.0/mei-Mensural.rng" name="application/xml" schemanamens="http://purl.oclc.org/dsdl/schematron"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" xmlns:xlink="http://www.w3.org/1999/xlink"
    xml:id="m-1" meiversion="5.0">
    <meiHead xml:id="m-2">
        <fileDesc xml:id="m-3">
            <titleStmt xml:id="m-4">
                <title xml:id="m-14">trial</title>
            </titleStmt>
            <pubStmt xml:id="m-18"/>
        </fileDesc>
    </meiHead>
    <music xml:id="m-22">
        <body xml:id="m-23">
            <mdiv xml:id="m-24">
                <score xml:id="m-26">
                    <scoreDef xml:id="m-27">
                        <staffGrp xml:id="m-28">
                            <staffGrp xml:id="m-41" n="1" symbol="bracket">
                                <staffDef xml:id="m-29" clef.line="2" clef.shape="G" lines="5" n="1"
                                    notationtype="premensural">
                                    <label xml:id="m-30">iii [triplum]</label>
                                </staffDef>
                                <staffDef xml:id="m-33" clef.line="2" clef.shape="G" lines="5" n="2"
                                    notationtype="premensural">
                                    <label xml:id="m-34">[duplum]</label>
                                </staffDef>
                            </staffGrp>
                        </staffGrp>
                    </scoreDef>
                    <section xml:id="m-42">
                        <staff n="1">
                            <layer n="1">
                                <!-- 1st syllable -->
                                <ligature xml:id="n001">
                                    <verse>
                                        <syl sameas="#syl001"/>
                                    </verse>
                                    <note pname="f" oct="5"/>
                                    <note pname="e" oct="5" lig="conjunctura"/>
                                    <note pname="d" oct="5" lig="conjunctura"/>
                                </ligature>
                                <!-- 2nd syllable -->
                                <note xml:id="n002" pname="c" oct="5" name="virga">
                                    <verse>
                                        <syl sameas="#syl002"/>
                                    </verse>
                                </note>
                                <!-- 3rd syllable -->
                                <note xml:id="n003" pname="c" oct="5" name="punctum">
                                    <verse>
                                        <syl sameas="#syl003"/>
                                    </verse>
                                </note>
                                <!-- 4th syllable -->
                                <ligature>
                                    <note xml:id="n004" pname="a" oct="4" name="punctum">
                                        <verse>
                                            <syl sameas="#syl004"/>
                                        </verse>
                                    </note>
                                    <note xml:id="n005" pname="a" oct="4" name="virga"/>
                                </ligature>
                                <!-- 5th syllable -->
                                <note xml:id="n006" pname="a" oct="4" name="virga">
                                    <verse>
                                        <syl sameas="#syl005"/>
                                    </verse>
                                </note>
                            </layer>
                        </staff>
                        <staff n="2">
                            <layer n="1">
                                <!-- 1st syllable -->
                                <ligature synch="#n001">
                                    <verse>
                                        <syl xml:id="syl001">Mi-</syl>
                                    </verse>
                                    <note pname="f" oct="4"/>
                                    <note pname="g" oct="4"/>
                                </ligature>
                                <!-- 2nd syllable -->
                                <note synch="#n002" pname="a" oct="4" name="virga">
                                    <verse>
                                        <syl xml:id="syl002">ro</syl>
                                    </verse>
                                </note>
                                <!-- 3rd syllable -->
                                <note synch="#n003" pname="a" oct="4" name="punctum">
                                    <verse>
                                        <syl xml:id="syl003">ge</syl>
                                    </verse>
                                </note>
                                <!-- 4th syllable -->
                                <note synch="#n004" pname="a" oct="4" name="punctum">
                                    <verse>
                                        <syl xml:id="syl004">ne</syl>
                                    </verse>
                                </note>
                                <note></note>
                                <!-- 5h syllable -->
                                <note synch="#n006" pname="a" oct="4" name="punctum">
                                    <verse>
                                        <syl xml:id="syl005">re</syl>
                                    </verse>
                                </note>
                            </layer>
                        </staff>
                    </section>
                </score>
            </mdiv>
        </body>
    </music>
</mei>`;
