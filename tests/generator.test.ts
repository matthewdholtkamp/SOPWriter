import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/generator/buildDocx";
import { createSyntheticSpec } from "./fixtures";

async function docxXml(spec = createSyntheticSpec()) {
  const archive = unzipSync(new Uint8Array(await (await buildDocx(spec)).arrayBuffer()));
  const text = (path: string) => strFromU8(archive[path]);
  const headers = Object.keys(archive)
    .filter((path) => /^word\/header\d+\.xml$/.test(path))
    .map(text);
  const footerName = Object.keys(archive).find((path) => /^word\/footer\d+\.xml$/.test(path));
  return {
    document: text("word/document.xml"),
    firstHeader: headers.find((header) => header.includes("Defense Health Agency")) ?? "",
    continuationHeader: headers.find((header) => header.includes("SUBJECT:")) ?? "",
    footer: footerName ? text(footerName) : ""
  };
}

describe("buildDocx", () => {
  it("generates GLWCH identity, page settings, title page, and signature block", async () => {
    const xml = await docxXml();
    expect(xml.document).toContain('w:w="12240"');
    expect(xml.document).toContain('w:h="15840"');
    expect(xml.document).toContain("GLWCH Regulation No. 40-43");
    expect(xml.document).toContain("SUBJECT:  Fall Prevention Program");
    expect(xml.document).toContain("References:  See Enclosure 1.");
    expect(xml.document).toContain("MATTHEW D. HOLTKAMP");
    expect(xml.document).toContain('w:left="4680"');
    expect(xml.document).toContain("<w:titlePg/>");
    expect(xml.firstHeader).not.toContain("Defense Health Agency");
    expect(xml.continuationHeader).toContain("SUBJECT:  Fall Prevention Program");
    expect(xml.footer).toContain("PAGE");
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
    expect(xml.document).toContain("(a)  DoD Directive");
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
});
