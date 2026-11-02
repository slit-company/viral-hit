/**
 * Camera moves as cinematographers name them. Each move carries the plain description every video
 * model understands and, where a model family documents its own camera commands, that command too.
 */
export type CameraMoveGroup = 'push' | 'orbit' | 'pan' | 'vertical' | 'follow' | 'energy' | 'optical' | 'still';
export type CameraMove = {
  id: string;
  group: CameraMoveGroup;
  /** Natural-language description placed in the prompt. */
  text: string;
  /** MiniMax/Hailuo bracket commands, documented for their director mode. */
  bracket?: string;
  /** Moves that read best with more time on screen. */
  minSeconds?: number;
};

const move = (id: string, group: CameraMoveGroup, text: string, bracket?: string, minSeconds?: number): CameraMove =>
  ({ id, group, text, ...(bracket ? { bracket } : {}), ...(minSeconds ? { minSeconds } : {}) });

export const CAMERA_MOVES = [
  move('static', 'still', 'locked-off static camera, no camera movement', 'Static shot'),
  move('dolly-in', 'push', 'slow dolly in toward the subject', 'Push in'),
  move('dolly-out', 'push', 'slow dolly out away from the subject', 'Pull out'),
  move('super-dolly-in', 'push', 'fast, continuous dolly in that ends tight on the subject', 'Push in', 4),
  move('crash-zoom-in', 'optical', 'sudden crash zoom in on the subject', 'Zoom in'),
  move('crash-zoom-out', 'optical', 'sudden crash zoom out revealing the surroundings', 'Zoom out'),
  move('dolly-zoom', 'optical', 'dolly zoom (vertigo effect): the camera moves back while zooming in, the background stretches', undefined, 4),
  move('orbit-left', 'orbit', 'camera arcs left around the subject, keeping them centered', 'Truck left,Pan right'),
  move('orbit-right', 'orbit', 'camera arcs right around the subject, keeping them centered', 'Truck right,Pan left'),
  move('orbit-360', 'orbit', 'full 360-degree orbit around the subject', undefined, 6),
  move('lazy-susan', 'orbit', 'the subject stays still while the camera slowly circles at product-turntable speed', undefined, 5),
  move('pan-left', 'pan', 'smooth pan left', 'Pan left'),
  move('pan-right', 'pan', 'smooth pan right', 'Pan right'),
  move('whip-pan', 'energy', 'fast whip pan with motion blur', 'Pan right'),
  move('truck-left', 'pan', 'camera trucks left alongside the subject', 'Truck left'),
  move('truck-right', 'pan', 'camera trucks right alongside the subject', 'Truck right'),
  move('tilt-up', 'vertical', 'slow tilt up revealing the scene above', 'Tilt up'),
  move('tilt-down', 'vertical', 'slow tilt down', 'Tilt down'),
  move('crane-up', 'vertical', 'crane up rising high above the subject', 'Pedestal up'),
  move('crane-down', 'vertical', 'crane down descending to the subject', 'Pedestal down'),
  move('overhead', 'vertical', 'top-down overhead shot slowly rotating', undefined),
  move('tracking', 'follow', 'tracking shot following the subject from behind at walking pace', 'Tracking shot'),
  move('leading', 'follow', 'leading shot: the camera moves backward in front of the subject as they advance', 'Pull out'),
  move('side-tracking', 'follow', 'side tracking shot moving parallel with the subject', 'Truck right'),
  move('fpv-drone', 'energy', 'FPV drone shot diving and weaving through the scene at speed', undefined, 4),
  move('aerial-reveal', 'vertical', 'aerial drone shot rising and pulling back to reveal the landscape', 'Pedestal up', 5),
  move('handheld', 'energy', 'handheld camera with natural, subtle shake', 'Shake'),
  move('snorricam', 'energy', 'snorricam: camera rigged to the subject, face locked in frame while the world moves around them'),
  move('bullet-time', 'energy', 'bullet time: action frozen while the camera sweeps around the subject', undefined, 4),
  move('rack-focus', 'optical', 'rack focus from the foreground to the subject'),
  move('through-object', 'push', 'camera pushes through a foreground object into the scene'),
  move('hyperlapse', 'energy', 'hyperlapse moving forward while time speeds up', undefined, 5),
  move('low-angle-push', 'push', 'low-angle push in, the subject towers over the camera', 'Push in'),
] as const satisfies readonly CameraMove[];

export type CameraMoveId = (typeof CAMERA_MOVES)[number]['id'];
export const CAMERA_MOVE_IDS = CAMERA_MOVES.map(item => item.id) as [CameraMoveId, ...CameraMoveId[]];
const byId = new Map<string, CameraMove>(CAMERA_MOVES.map(item => [item.id, item]));
export const cameraMove = (id: string) => byId.get(id) ?? null;
