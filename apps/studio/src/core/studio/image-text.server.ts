import { probeMedia } from '../harness/probe-media';
import { runSceneProcess } from '../references/scene-process.server';
import { tesseractEngine } from '../remix/grammar-analysis.server';
import { mergeTextBlocks, parseTesseractTsv, type TextBlock } from '../remix/onscreen-text';
import { LOCAL_PROJECT_ASSET_BUCKET, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';

/**
 * Local and free: the text in a project image with its position, read by Tesseract in every installed
 * language. Two page layouts are read and merged, so both captions and sparse sign text are found.
 */
export async function readImageText(projectId: string, assetId: string): Promise<{ languages: string[]; blocks: TextBlock[] }> {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.type !== 'image' || asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET || !asset.objectKey) throw Error('Choose an image from this project');
  const signal = AbortSignal.timeout(60_000);
  const engine = await tesseractEngine(signal);
  if (!engine) throw Error('Text detection needs Tesseract on the server (for example brew install tesseract tesseract-lang). You can still type the text to replace.');
  const file = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
  const { width, height } = await probeMedia(file, 'image', signal);
  if (!width || !height) throw Error('The image size could not be read');
  const read = async (layout: string) => parseTesseractTsv(await runSceneProcess(engine.binary, [file, 'stdout', '-l', engine.languages.join('+'), '--psm', layout, 'tsv'], signal, 30_000, 2 * 1024 * 1024), width, height);
  return { languages: engine.languages, blocks: mergeTextBlocks(await read('11'), await read('3')) };
}
