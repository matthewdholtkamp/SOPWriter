import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/generator/buildDocx";
import { createSyntheticSpec } from "./fixtures";

async function docxXml(spec = createSyntheticSpec()) {
  const archive = unzipSync(new Uint8Array(await (await buildDocx(spec)).arrayBuffer()));
  const text = (path: string) => strFromU8(archive[path]);
  const visibleText = (xml: string) =>
    [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) =>
        match[1]
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&")
      )
      .join("");
  const document = text("word/document.xml");
  return {
    archive,
    document,
    documentText: visibleText(document),
    footer3: text("word/footer3.xml"),
    footer5: text("word/footer5.xml"),
    footer6: text("word/footer6.xml"),
    footer7: text("word/footer7.xml"),
    footer8: text("word/footer8.xml"),
    header2: text("word/header2.xml"),
    numbering: text("word/numbering.xml"),
    styles: text("word/styles.xml")
  };
}

describe("buildDocx", () => {
  it("generates the official GLWCH cover and section package", async () => {
    const xml = await docxXml();
    expect(xml.document).toContain('w:w="12240"');
    expect(xml.document).toContain('w:h="15840"');
    expect(xml.documentText).toContain("Defense Health Agency");
    expect(xml.documentText).toContain("General Leonard Wood Community Hospital");
    expect(xml.documentText).toContain("REGULATION");
    expect(xml.documentText).toContain("NUMBER 40-43");
    expect(xml.documentText).toContain("SUBJECT:Fall Prevention Program");
    expect(xml.documentText).toContain("References:See Enclosure 1.");
    expect(xml.documentText).toContain("MATTHEW D. HOLTKAMP");
    expect(xml.document).toContain('w:pos="4680"');
    expect(xml.document).toContain('name="Straight Connector 1"');
    expect(xml.document).toContain('name="Straight Connector 2"');
    expect(xml.document).toContain('name="Straight Connector 3"');
    expect(xml.document).toContain("<w:titlePg/>");
    expect(xml.document.match(/<w:sectPr/g)).toHaveLength(5);
    expect(xml.document).not.toContain("<w:sdt");
    const paragraphIds = [...xml.document.matchAll(/w14:paraId="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(new Set(paragraphIds).size).toBe(paragraphIds.length);
    expect(Object.keys(xml.archive)).toEqual(expect.arrayContaining([
      "word/header1.xml",
      "word/header2.xml",
      "word/header3.xml",
      "word/footer9.xml",
      "word/theme/theme1.xml",
      "word/media/image1.png",
      "customXml/item6.xml"
    ]));
    expect(xml.styles).toContain('w:styleId="Heading1"');
    expect(xml.numbering).toContain("<w:abstractNum");
  });

  it("patches running headers and enclosure footers with final publication values", async () => {
    const xml = await docxXml();
    expect(xml.header2).toContain("GLWCH Reg 40-43");
    expect(xml.header2).toContain("January 1, 2026");
    expect(xml.header2).not.toContain("XXXX.XX");
    expect(xml.footer3).not.toContain("DHA-");
    expect(xml.footer3).not.toContain("template as of");
    expect(xml.footer5).toContain("ENCLOSURE ");
    expect(xml.footer5).toContain(">1<");
    expect(xml.footer6).toContain("ENCLOSURE 2");
    expect(xml.footer7).toContain("ENCLOSURE 3");
    expect(xml.footer8).toContain("GLOSSARY");
  });

  it("removes visible instructional template text from the final document body", async () => {
    const xml = await docxXml();
    expect(xml.document).not.toContain("The PSB enters date");
    expect(xml.document).not.toContain("The Publication Systems Branch");
    expect(xml.document).not.toContain("FOR DHA-PMs ONLY");
    expect(xml.document).not.toContain("EDITING CHECKLIST");
    expect(xml.document).not.toContain("DHA Add Proponent");
    expect(xml.document).not.toContain("NUMBER XXXX.XX");
  });

  it("renders DHA paragraph labels and enclosures", async () => {
    const xml = await docxXml(
      createSyntheticSpec({
        enclosures: {
          responsibilities: [
            {
              heading: "Official",
              text: "The official will act.",
              children: [
                { text: "First child.", children: [] },
                {
                  text: "Second child.",
                  children: [
                    { text: "Nested one.", children: [] },
                    { text: "Nested two.", children: [] }
                  ]
                }
              ]
            },
            { heading: "Second Official", text: "The second official will act.", children: [] }
          ],
          procedures: [
            { heading: "Procedure", text: "Step one.", children: [] },
            { heading: "Review", text: "Step two.", children: [] }
          ],
          appendices: [
            {
              title: "Fall Risk Tool",
              body: [{ heading: "Score", text: "Record the score.", children: [] }]
            }
          ]
        }
      })
    );
    expect(xml.documentText).toContain("ENCLOSURE 1");
    expect(xml.documentText).toContain("REFERENCES");
    expect(xml.documentText).toContain("(a)DoD Directive");
    expect(xml.documentText).toContain("ENCLOSURE 2");
    expect(xml.documentText).toContain("1.  Official.  The official will act.");
    expect(xml.documentText).toContain("a.  First child.");
    expect(xml.documentText).toContain("(1)  Nested one.");
    expect(xml.documentText).toContain("ENCLOSURE 3");
    expect(xml.documentText).toContain("APPENDIXFALL RISK TOOL");
    expect(xml.documentText).toContain("Record the score.");
    expect(xml.document).toContain('<w:u w:val="single"/>');
  });

  it("omits optional sections and renumbers visible sections", async () => {
    const base = createSyntheticSpec();
    const xml = await docxXml(
      createSyntheticSpec({ sections: { ...base.sections, canceledDocuments: null } })
    );
    expect(xml.documentText).not.toContain("CANCELED DOCUMENTS");
    expect(xml.documentText).toContain("4.  RESPONSIBILITIES");
  });

  it("preserves detailed converted fall-prevention content", async () => {
    const spec = createSyntheticSpec({
      enclosures: {
        responsibilities: [
          { heading: "Information Desk", text: "Staff will offer wheelchair assistance to customers identified as falls risk customers.", children: [] },
          { heading: "Head Nurses and NCOICs", text: "Leaders will inspect patient care areas for safety issues and monitor trends.", children: [] },
          { heading: "All Hospital Staff", text: "Personnel will maintain a safe patient care environment and report unsafe conditions.", children: [] }
        ],
        procedures: [
          { heading: "Adult Falls Protocol", text: "Adult standard falls protocol will be implemented and documented.", children: [] },
          { heading: "Pediatric Falls Protocol", text: "Pediatric standard falls protocol will be provided to all pediatric patients.", children: [] },
          { heading: "Post-Fall Documentation", text: "Documentation will include injury, contributing factors, notifications, and follow-up plan.", children: [] }
        ],
        appendices: []
      }
    });
    const xml = await docxXml(spec);
    expect(xml.document).toContain("Information Desk");
    expect(xml.document).toContain("Head Nurses and NCOICs");
    expect(xml.document).toContain("All Hospital Staff");
    expect(xml.document).toContain("Adult Falls Protocol");
    expect(xml.document).toContain("Pediatric Falls Protocol");
    expect(xml.document).toContain("Post-Fall Documentation");
  });
});
