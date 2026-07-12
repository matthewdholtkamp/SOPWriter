import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import "./installDomGlobals";
import { buildDocx } from "../src/generator/buildDocx";
import { createDefaultSpec } from "../src/model/defaultSpec";

async function save(name: string): Promise<void> {
  const spec = createDefaultSpec();
  spec.subject = "Synthetic SOP Writer QA Publication";
  spec.publicationNumber = "40-99";
  const blob = await buildDocx(spec);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const output = resolve("output/qa", name);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, buffer);
}

await save("sopwriter-qa.docx");
