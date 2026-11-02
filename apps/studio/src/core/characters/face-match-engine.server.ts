import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { getViralHitDataRoot } from '@/config/data-root';

/** OpenCV Zoo face models, downloaded only on request and verified by hash. They keep their upstream licenses. */
export const FACE_MODELS = [
  { file: 'face_detection_yunet_2023mar.onnx', bytes: 232_589, license: 'MIT', sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4', url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx' },
  { file: 'face_recognition_sface_2021dec.onnx', bytes: 38_696_353, license: 'Apache-2.0', sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79', url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx' },
] as const;

export const faceModelDirectory = () => process.env.VIRAL_HIT_FACE_MODELS?.trim() || join(getViralHitDataRoot(), 'models', 'face-match');
const python = () => process.env.VIRAL_HIT_PYTHON?.trim() || 'python3';
const modelPath = (file: string) => join(faceModelDirectory(), file);

async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Downloads missing or damaged models; verified files already present are kept. */
export async function installFaceModels(signal = AbortSignal.timeout(600_000)) {
  await mkdir(faceModelDirectory(), { recursive: true });
  const downloaded: string[] = [];
  for (const model of FACE_MODELS) {
    const target = modelPath(model.file);
    if ((await stat(target).catch(() => null))?.size === model.bytes && await fileHash(target) === model.sha256) continue;
    const response = await fetch(model.url, { signal, redirect: 'follow' });
    if (!response.ok) throw Error(`Could not download ${model.file} (HTTP ${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== model.bytes || createHash('sha256').update(bytes).digest('hex') !== model.sha256) throw Error(model.file + ' does not match its pinned hash');
    await writeFile(target + '.partial', bytes);
    await rename(target + '.partial', target);
    downloaded.push(model.file);
  }
  return { directory: faceModelDirectory(), downloaded };
}

let opencv: Promise<boolean> | null = null;
/** Null when face match can run; otherwise what to set up. Nothing is downloaded or installed here. */
export async function faceMatchProblem() {
  for (const model of FACE_MODELS) {
    if ((await stat(modelPath(model.file)).catch(() => null))?.size !== model.bytes) return 'Face models are not installed. Run: pnpm character face-setup';
  }
  opencv ??= new Promise(resolve => execFile(python(), ['-c', 'import cv2; cv2.FaceDetectorYN; cv2.FaceRecognizerSF'], { timeout: 20_000 }, error => resolve(!error)));
  if (await opencv) return null;
  opencv = null; // check again after the operator installs it
  return 'Face match needs Python with OpenCV 4.8 or newer (pip install opencv-python-headless). Set VIRAL_HIT_PYTHON to use another Python.';
}

const output = z.object({
  referenceFaces: z.number().int().min(0),
  candidates: z.array(z.object({ id: z.string(), frames: z.array(z.object({ time: z.number().nullable(), faces: z.number().int().min(0), similarity: z.number().min(-1).max(1).nullable() }).strict()) }).strict()),
}).strict();

/** Runs YuNet detection and SFace recognition in a short-lived Python process. Files are only read. */
export async function compareFaces(references: string[], candidates: { id: string; frames: { time: number | null; path: string }[] }[], signal: AbortSignal) {
  const request = JSON.stringify({ detector: modelPath(FACE_MODELS[0].file), recognizer: modelPath(FACE_MODELS[1].file), references, candidates });
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(python(), ['-c', FACE_MATCH_SCRIPT], { signal, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk; if (out.length > 4_000_000) child.kill(); });
    child.stderr.setEncoding('utf8').on('data', chunk => { err = (err + chunk).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(Error('Face match failed: ' + (err.trim().split('\n').pop() || 'exit ' + code))));
    child.stdin.end(request);
  });
  return output.parse(JSON.parse(stdout));
}

// The largest face of each reference becomes a reference vector; each frame keeps its best match over all faces.
const FACE_MATCH_SCRIPT = String.raw`import json, sys
import cv2

request = json.load(sys.stdin)
detector = cv2.FaceDetectorYN.create(request["detector"], "", (320, 320), 0.7, 0.3, 5000)
recognizer = cv2.FaceRecognizerSF.create(request["recognizer"], "")
COSINE = getattr(cv2, "FaceRecognizerSF_FR_COSINE", 0)
MIN_FACE = 32


def faces(path):
    image = cv2.imread(path)
    if image is None:
        return None, []
    height, width = image.shape[:2]
    scale = min(1.0, 1280 / max(height, width))
    if scale < 1:
        image = cv2.resize(image, (round(width * scale), round(height * scale)))
        height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, found = detector.detect(image)
    if found is None:
        return image, []
    found = [face for face in found if face[2] >= MIN_FACE and face[3] >= MIN_FACE]
    return image, sorted(found, key=lambda face: -face[2] * face[3])[:8]


def feature(image, face):
    return recognizer.feature(recognizer.alignCrop(image, face))


references = []
for path in request["references"]:
    image, found = faces(path)
    if found:
        references.append(feature(image, found[0]))

result = {"referenceFaces": len(references), "candidates": []}
for candidate in request["candidates"]:
    frames = []
    for frame in candidate["frames"]:
        image, found = faces(frame["path"])
        best = None
        for face in found if references else []:
            vector = feature(image, face)
            score = max(float(recognizer.match(reference, vector, COSINE)) for reference in references)
            best = score if best is None else max(best, score)
        frames.append({"time": frame.get("time"), "faces": len(found), "similarity": None if best is None else round(best, 4)})
    result["candidates"].append({"id": candidate["id"], "frames": frames})
json.dump(result, sys.stdout)
`;
