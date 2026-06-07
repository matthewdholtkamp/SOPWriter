import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/generator/buildDocx";
import { createSyntheticSpec } from "./fixtures";

async function docxXml(spec = createSyntheticSpec()) {
  const archive = unzipSync(new Uint8Array(await (await buildDocx(spec)).arrayBuffer()));
  const text = (path: string) => strFromU8(archive[path]);
  return {
    archive,
    document: text("word/document.xml"),
    numbering: text("word/numbering.xml"),
    styles: text("word/styles.xml")
  };
}

describe("buildDocx", () => {
  it("generates GLWCH identity with the official template package parts preserved", async () => {
    const xml = await docxXml();
    expect(xml.document).toContain('w:w="12240"');
    expect(xml.document).toContain('w:h="15840"');
    expect(xml.document).toContain("GLWCH Regulation No. 40-43");
    expect(xml.document).toContain("SUBJECT:");
    expect(xml.document).toContain("Fall Prevention Program");
    expect(xml.document).toContain("References:");
    expect(xml.document).toContain("See Enclosure 1.");
    expect(xml.document).toContain("MATTHEW D. HOLTKAMP");
    expect(xml.document).toContain('w:left="4680"');
    expect(xml.document).toContain("<w:titlePg/>");
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

  it("removes visible instructional template text from the final document body", async () => {
    const xml = await docxXml();
    expect(xml.document).not.toContain("The PSB enters date");
    expect(xml.document).not.toContain("The Publication Systems Branch");
    expect(xml.document).not.toContain("FOR DHA-PMs ONLY");
    expect(xml.document).not.toContain("EDITING CHECKLIST");
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
    expect(xml.document).toContain("ENCLOSURE 1");
    expect(xml.document).toContain("REFERENCES");
    expect(xml.document).toContain("(a)");
    expect(xml.document).toContain("DoD Directive");
    expect(xml.document).toContain("ENCLOSURE 2");
    expect(xml.document).toContain("1.  ");
    expect(xml.document).toContain("Official.  ");
    expect(xml.document).toContain("The official will act.");
    expect(xml.document).toContain("a.  ");
    expect(xml.document).toContain("First child.");
    expect(xml.document).toContain("(1)  ");
    expect(xml.document).toContain("Nested one.");
    expect(xml.document).toContain("ENCLOSURE 3");
    expect(xml.document).toContain("APPENDIX: FALL RISK TOOL");
    expect(xml.document).toContain("Record the score.");
  });

  it("omits optional sections and renumbers visible sections", async () => {
    const base = createSyntheticSpec();
    const xml = await docxXml(
      createSyntheticSpec({ sections: { ...base.sections, canceledDocuments: null } })
    );
    expect(xml.document).not.toContain("CANCELED DOCUMENTS");
    expect(xml.document).toContain("4.  RESPONSIBILITIES");
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
